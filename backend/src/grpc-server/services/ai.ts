// AI service implementation for gRPC
import type { Metadata } from "@grpc/grpc-js";
import { logger } from "../util/logging.js";
import { requireBearer } from "../util/auth.js";
import { ERR } from "../util/errors.js";
import { getClient } from "../../ai/llm.js";

// Helper to enhance short prompts using OpenAI
async function enhancePrompt(prompt: string): Promise<string> {
  try {
    const words = prompt.trim().split(/\s+/).filter(Boolean);
    // If prompt is already detailed (16+ words), don't enhance
    if (words.length >= 16) return prompt;
    
    const client = await getClient();
    const sys = [
      'You are a world-class prompt engineer.',
      'Rewrite and expand the user brief into a clear, constraint-driven prompt for an LLM.',
      'Prefer specificity; include inputs/outputs, formatting, and acceptance criteria.',
      'Keep the final prompt under ~300 words.',
    ].join(' ');
    const reqPrompt = [
      'Brief to enhance:',
      '---',
      prompt,
      '---',
      'Return JSON with shape:',
      '{"prompt":"<enhanced prompt>"}',
    ].join('\n');
    const resp: any = await client.generate({ system: sys, prompt: reqPrompt, options: { temperature: 0.3 } });
    const text: string = resp?.response ?? resp?.message?.content ?? resp?.content ?? '';
    try {
      const data = JSON.parse(text);
      const enhanced = String((data as any)?.prompt ?? '').trim();
      return enhanced || prompt;
    } catch {
      const trimmed = String(text || '').trim();
      return trimmed || prompt;
    }
  } catch {
    return prompt;
  }
}

/**
 * AI service implementation
 * 
 * Implements all AI-powered features:
 * - Code generation (HTML, React)
 * - Content creation (briefs, SEO meta)
 * - SEO enhancement (prompt enhancement, hints)
 * - Chat functionality
 */
export const AIServiceImpl = {
  /**
   * GenerateCode - Generate landing pages (HTML or React)
   */
  async GenerateCode(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      // Validate required fields
      if (!params.prompt) {
        return callback(ERR.invalidArgument("prompt is required"), null);
      }

      let prompt = String(params.prompt);
      const format = params.format || 'html';
      const sections = params.sections || ['hero', 'features', 'pricing', 'cta'];
      const brand = params.brand || {};
      const stream = Boolean(params.stream);
      const options = params.options || {};
      const sessionId = params.sessionId;
      const storeId = params.storeId;
      const title = params.title || `Codegen: ${format.toUpperCase()}`;

      logger.info({ sellerId: subject, format, sections }, "AIService.GenerateCode");

      // Enhance short prompts
      try {
        const enhanced = await enhancePrompt(prompt);
        if (enhanced && enhanced !== prompt) {
          logger.info({ originalLength: prompt.length, enhancedLength: enhanced.length }, "Prompt enhanced");
          prompt = enhanced;
        }
      } catch (e) {
        logger.warn({ err: e }, "Prompt enhancement failed, using original");
      }

      // Build system prompt similar to codegen route
      const brandInfo = brand?.name
        ? `Brand: ${brand.name}${brand.primaryColor ? `, Primary Color: ${brand.primaryColor}` : ''}${brand.font ? `, Font: ${brand.font}` : ''}${brand.logoUrl ? `, Logo: ${brand.logoUrl}` : ''}`
        : '';

      const sys = [
        `You are an expert landing page generator. Generate a modern, professional ${format.toUpperCase()} landing page.`,
        `Required sections: ${sections.join(', ')}.`,
        brandInfo ? `Brand requirements: ${brandInfo}` : '',
        '',
        'Design System (ITTRI Aesthetic):',
        '- Background: Use cosmic gradient (bg-gradient-to-b from-sky-50 via-purple-50 to-indigo-50 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-900)',
        '- Glass morphism: Use class "glass" or bg-white/10 dark:bg-neutral-800/30 with backdrop-blur-md for cards/sections',
        '- Buttons: Use class "btn-futuristic" for primary CTAs, or style with rounded-lg, gradient backgrounds, hover effects',
        '- Typography: Use semantic HTML, proper heading hierarchy (h1-h6), responsive text sizing',
        '- Spacing: Use Tailwind padding/margin utilities (p-4, p-6, p-8, mx-auto, max-w-7xl, etc.)',
        '- Colors: Use CSS variables (var(--foreground), var(--background), var(--primary)) instead of hard-coded colors',
        '- Responsive: Mobile-first design with sm:, md:, lg: breakpoints',
        '- Accessibility: Include proper ARIA labels, alt text for images, semantic HTML',
        '',
        format === 'html' 
          ? 'HTML Requirements: Include <!DOCTYPE html>, <html>, <head> with meta tags, <title>, link to Tailwind CSS CDN, and <body> with complete landing page structure.'
          : 'React Requirements: Export default function component named App. Use React hooks if needed. Include proper imports.',
        '',
        'Content Guidelines:',
        '- Write compelling, clear copy that explains the product/service value proposition',
        '- Use power words and action-oriented language',
        '- Include social proof elements (testimonials, stats, logos) when appropriate',
        '- Ensure CTAs are clear and prominent',
        '',
        `Output only the ${format === 'html' ? 'complete, valid HTML document' : 'complete React component'} without any explanation, commentary, or markdown code blocks.`,
      ].filter(Boolean).join('\n');

      // Call LLM client
      const client = await getClient();
      const modelResp = await client.generate({
        prompt: [sys, prompt].join('\n'),
        stream: false, // gRPC doesn't support streaming in this simple implementation
        options: { 
          temperature: options?.temperature ?? 0.2, 
          max_tokens: options?.max_tokens ?? 4000 
        },
      });

      const code = (modelResp as any)?.response ?? 
                   (modelResp as any)?.message?.content ?? 
                   (modelResp as any)?.content ?? 
                   '';

      const response = {
        ok: true,
        sessionId: sessionId || `grpc-${Date.now()}`,
        code: String(code),
        format,
        message: {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: 'Code generated successfully'
        }
      };

      logger.info({ sellerId: subject, codeLength: code.length, format }, "AIService.GenerateCode completed");
      callback(null, { body: response });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.GenerateCode" });
      callback(ERR.internal(e.message || "Code generation failed"), null);
    }
  },

  /**
   * CreateBrief - Create content briefs
   */
  async CreateBrief(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      if (!params.topic) {
        return callback(ERR.invalidArgument("topic is required"), null);
      }

      logger.info({ sellerId: subject, topic: params.topic }, "AIService.CreateBrief");

      // TODO: Implement actual brief generation logic
      const mockResponse = {
        ok: true,
        sessionId: params.sessionId || 'mock-session-id',
        message: {
          id: 'mock-msg-id',
          role: 'assistant',
          content: `Brief for topic: ${params.topic}\n\nAudience: ${params.audience || 'General'}\nTone: ${params.tone || 'Neutral'}`
        }
      };

      callback(null, { body: mockResponse });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.CreateBrief" });
      callback(ERR.internal(e.message || "Brief creation failed"), null);
    }
  },

  /**
   * ExtractMeta - Extract SEO metadata from URLs
   */
  async ExtractMeta(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      if (!params.url) {
        return callback(ERR.invalidArgument("url is required"), null);
      }

      logger.info({ sellerId: subject, url: params.url }, "AIService.ExtractMeta");

      // TODO: Implement actual meta extraction logic
      const mockResponse = {
        ok: true,
        sessionId: params.sessionId || 'mock-session-id',
        message: {
          id: 'mock-msg-id',
          role: 'assistant',
          content: JSON.stringify({
            title: `SEO Title for ${params.url}`,
            description: 'SEO description...',
            keywords: ['keyword1', 'keyword2']
          })
        }
      };

      callback(null, { body: mockResponse });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.ExtractMeta" });
      callback(ERR.internal(e.message || "Meta extraction failed"), null);
    }
  },

  /**
   * EnhancePrompt - Enhance user prompts
   */
  async EnhancePrompt(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      if (!params.brief) {
        return callback(ERR.invalidArgument("brief is required"), null);
      }

      logger.info({ sellerId: subject }, "AIService.EnhancePrompt");

      // TODO: Implement actual prompt enhancement logic
      const mockResponse = {
        ok: true,
        prompt: `Enhanced version of: ${params.brief}`,
        tips: ['Tip 1', 'Tip 2'],
        checks: ['Check 1', 'Check 2']
      };

      callback(null, { body: mockResponse });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.EnhancePrompt" });
      callback(ERR.internal(e.message || "Prompt enhancement failed"), null);
    }
  },

  /**
   * GenerateHints - Generate SEO hints
   */
  async GenerateHints(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      if (!params.topic) {
        return callback(ERR.invalidArgument("topic is required"), null);
      }

      logger.info({ sellerId: subject, topic: params.topic }, "AIService.GenerateHints");

      // TODO: Implement actual hints generation logic
      const mockResponse = {
        ok: true,
        hints: [
          `Hint 1 for ${params.topic}`,
          'Hint 2...',
          'Hint 3...'
        ],
        style: params.style || 'concise'
      };

      callback(null, { body: mockResponse });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.GenerateHints" });
      callback(ERR.internal(e.message || "Hints generation failed"), null);
    }
  },

  /**
   * SendChatMessage - Send chat messages
   */
  async SendChatMessage(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      if (!params.message) {
        return callback(ERR.invalidArgument("message is required"), null);
      }

      logger.info({ sellerId: subject }, "AIService.SendChatMessage");

      // TODO: Implement actual chat logic with streaming support
      const mockResponse = {
        ok: true,
        sessionId: params.sessionId || 'mock-session-id',
        message: {
          id: 'mock-msg-id',
          role: 'assistant',
          content: `Response to: ${params.message}`
        }
      };

      callback(null, { body: mockResponse });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.SendChatMessage" });
      callback(ERR.internal(e.message || "Chat message failed"), null);
    }
  },

  /**
   * ListSessions - List all chat sessions
   */
  async ListSessions(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      
      logger.info({ sellerId: subject }, "AIService.ListSessions");

      // TODO: Implement actual session listing from database
      const mockResponse = {
        ok: true,
        sessions: [
          {
            id: 'session-1',
            seller_id: subject,
            title: 'Chat Session 1',
            created_at: new Date().toISOString()
          }
        ]
      };

      callback(null, { body: mockResponse });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.ListSessions" });
      callback(ERR.internal(e.message || "List sessions failed"), null);
    }
  },

  /**
   * GetSession - Get specific session details
   */
  async GetSession(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      if (!params.sessionId) {
        return callback(ERR.invalidArgument("sessionId is required"), null);
      }

      logger.info({ sellerId: subject, sessionId: params.sessionId }, "AIService.GetSession");

      // TODO: Implement actual session retrieval
      const mockResponse = {
        ok: true,
        session: {
          id: params.sessionId,
          seller_id: subject,
          title: 'Chat Session',
          created_at: new Date().toISOString()
        }
      };

      callback(null, { body: mockResponse });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.GetSession" });
      callback(ERR.internal(e.message || "Get session failed"), null);
    }
  },

  /**
   * DeleteSession - Delete a chat session
   */
  async DeleteSession(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      if (!params.sessionId) {
        return callback(ERR.invalidArgument("sessionId is required"), null);
      }

      logger.info({ sellerId: subject, sessionId: params.sessionId }, "AIService.DeleteSession");

      // TODO: Implement actual session deletion
      const mockResponse = {
        ok: true,
        deleted: true
      };

      callback(null, { body: mockResponse });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.DeleteSession" });
      callback(ERR.internal(e.message || "Delete session failed"), null);
    }
  },

  /**
   * ListMessages - List messages for a session
   */
  async ListMessages(call: any, callback: any) {
    try {
      const subject = requireBearer(call.metadata as Metadata);
      const params = call.request?.body || {};
      
      if (!params.sessionId) {
        return callback(ERR.invalidArgument("sessionId is required"), null);
      }

      logger.info({ sellerId: subject, sessionId: params.sessionId }, "AIService.ListMessages");

      // TODO: Implement actual message listing
      const mockResponse = {
        ok: true,
        messages: [
          {
            id: 'msg-1',
            session_id: params.sessionId,
            role: 'user',
            content: 'Hello',
            created_at: new Date().toISOString()
          },
          {
            id: 'msg-2',
            session_id: params.sessionId,
            role: 'assistant',
            content: 'Hi! How can I help?',
            created_at: new Date().toISOString()
          }
        ]
      };

      callback(null, { body: mockResponse });
    } catch (e: any) {
      logger.error({ error: e, method: "AIService.ListMessages" });
      callback(ERR.internal(e.message || "List messages failed"), null);
    }
  }
};
