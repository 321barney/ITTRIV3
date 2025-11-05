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

      const prompt = String(params.prompt);
      const format = params.format || 'html';
      const sections = params.sections || ['hero', 'features', 'pricing', 'cta'];
      const brand = params.brand || {};
      const stream = Boolean(params.stream);
      const options = params.options || {};
      const sessionId = params.sessionId;
      const storeId = params.storeId;
      const title = params.title || `Codegen: ${format.toUpperCase()}`;

      logger.info({ sellerId: subject, format }, "AIService.GenerateCode");

      // TODO: Implement actual code generation logic
      // This would integrate with the database for session management
      // and call the LLM client for generation
      
      const mockResponse = {
        ok: true,
        sessionId: sessionId || 'mock-session-id',
        code: `<!-- Generated ${format} code for: ${prompt.slice(0, 50)}... -->`,
        format,
        message: {
          id: 'mock-msg-id',
          role: 'assistant',
          content: 'Code generated successfully'
        }
      };

      callback(null, { body: mockResponse });
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
