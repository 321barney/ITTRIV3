// src/api/routes/ai/generate.ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClient } from '../../../ai/llm.js';
import { generateViaGrpc, isGrpcAvailable } from '../../../ai/grpc-client.js';
import { enrichPrompt } from '../../../ai/prompt-enrichment.js';

const Body = z.object({
  seed: z.string().min(1).optional(),
  input: z.string().min(1),
  model: z.string().optional(),
  stream: z.boolean().optional(),
});

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth?: any;
  }
}

export default fp(async function registerGenerate(app: FastifyInstance) {
  const handler = async (req: any, reply: any) => {
    const parsed = Body.safeParse(req.body || {});
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: 'bad_request', details: parsed.error.flatten() });
    }
    const { seed: providedSeed, input, model, stream } = parsed.data;
    
    // Use provided seed or derive from input
    const seed = providedSeed || input.slice(0, 160);

    // Enrich the prompt if it's too short/vague
    const enrichmentResult = await enrichPrompt(input, { 
      minWords: 10,
      context: 'code generation'
    });
    
    const enrichedPrompt = enrichmentResult.enhanced;
    
    if (enrichmentResult.wasEnhanced) {
      req.log.info({ 
        originalWords: enrichmentResult.originalWordCount,
        enhancedWords: enrichmentResult.enhancedWordCount 
      }, 'Prompt enriched');
    }

    // Extract auth token for gRPC
    const authHeader = req.headers.authorization || '';
    
    // Try gRPC first (if available)
    let grpcResult = null;
    try {
      grpcResult = await generateViaGrpc(
        {
          prompt: enrichedPrompt,
          seed,
          input: enrichedPrompt,
          model,
          stream,
        },
        authHeader
      );

      if (grpcResult && grpcResult.ok !== false) {
        req.log.info({ method: 'gRPC', available: true }, 'AI generate success via gRPC');
        return reply.send({
          ok: true,
          ...grpcResult,
          via: 'grpc',
          enrichment: {
            wasEnhanced: enrichmentResult.wasEnhanced,
            originalPrompt: input,
            enhancedPrompt: enrichedPrompt,
            originalWordCount: enrichmentResult.originalWordCount,
            enhancedWordCount: enrichmentResult.enhancedWordCount
          }
        });
      } else {
        req.log.info({ method: 'gRPC', available: false, reason: 'returned null or error' }, 'gRPC unavailable, using REST fallback');
      }
    } catch (err: any) {
      req.log.warn({ err: err.message, method: 'gRPC' }, 'gRPC error, using REST fallback');
    }

    // Fallback to legacy REST implementation
    req.log.info({ method: 'REST', fallback: true }, 'AI generate using legacy REST implementation');
    
    const client = await getClient();

    // Stage 1: seed → system instruction
    const sysResp = await client.chat({
      model,
      messages: [
        { role: 'system', content: 'You are a prompt engineer. Convert the user seed into a crisp, bounded system instruction for a code/content generator. Return only the instruction.' },
        { role: 'user', content: seed },
      ],
      stream: false,
    });
    const systemInstruction = (sysResp as any)?.response || String(sysResp || '').trim();

    // Stage 2: generate using enriched prompt
    if (stream) {
      reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.write(':ok\n\n');

      const iter = (await client.chat({
        model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: enrichedPrompt },
        ],
        stream: true,
      })) as AsyncIterable<any>;

      let full = '';
      for await (const chunk of iter) {
        const t = chunk?.delta || chunk?.text || '';
        if (t) {
          full += t;
          reply.raw.write(`data: ${JSON.stringify({ delta: t })}\n\n`);
        }
      }
      reply.raw.write(`data: ${JSON.stringify({ done: true, text: full })}\n\n`);
      return reply.raw.end();
    }

    const gen = await client.chat({
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: enrichedPrompt },
      ],
      stream: false,
    });
    const text = (gen as any)?.response || String(gen || '').trim();
    return reply.send({ 
      ok: true, 
      system: systemInstruction, 
      text, 
      via: 'rest',
      enrichment: {
        wasEnhanced: enrichmentResult.wasEnhanced,
        originalPrompt: input,
        enhancedPrompt: enrichedPrompt,
        originalWordCount: enrichmentResult.originalWordCount,
        enhancedWordCount: enrichmentResult.enhancedWordCount
      }
    });
  };

  // Build route options with auth preHandler if available
  const routeOpts: any = {};
  if (app.requireAuth) {
    routeOpts.preHandler = app.requireAuth;
  }

  // Only the missing path; `/gen` already exists via the AI hub
  (app as any).post('/generate', routeOpts, handler);
}, { name: 'ai-generate' });
