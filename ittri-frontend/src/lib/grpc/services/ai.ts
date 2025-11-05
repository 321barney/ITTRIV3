/**
 * AI Service gRPC Client
 * 
 * Provides methods to interact with AI-powered features:
 * - Code generation (HTML, React)
 * - Content creation (briefs, SEO meta)
 * - SEO enhancement
 * - Chat functionality
 */

export interface CodegenRequest {
  prompt: string;
  format?: 'html' | 'react';
  sections?: string[];
  brand?: {
    name?: string;
    primaryColor?: string;
    font?: string;
    logoUrl?: string;
  };
  stream?: boolean;
  options?: {
    temperature?: number;
    max_tokens?: number;
  };
  sessionId?: string;
  storeId?: string;
  title?: string;
}

export interface CodegenResponse {
  ok: boolean;
  sessionId: string;
  code: string;
  format: string;
  message?: {
    id: string;
    role: string;
    content: string;
  };
}

export interface ChatMessage {
  sessionId?: string;
  storeId?: string;
  message: string;
  updateNeed?: string;
  stream?: boolean;
}

export interface ChatResponse {
  ok: boolean;
  sessionId: string;
  message: {
    id: string;
    role: string;
    content: string;
  };
}

/**
 * AI Service Client
 */
export class AIServiceClient {
  private token?: string;
  private baseUrl: string;

  constructor(token?: string, baseUrl: string = '/api/v1/ai') {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`AI service error: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Generate code (HTML or React)
   */
  async generateCode(request: CodegenRequest): Promise<CodegenResponse> {
    return this.request('/code/gen', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Create content brief
   */
  async createBrief(params: {
    topic: string;
    audience?: string;
    tone?: string;
    include_outline?: boolean;
    sessionId?: string;
    storeId?: string;
    title?: string;
  }): Promise<any> {
    return this.request('/content/brief', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Extract SEO metadata from URL
   */
  async extractMeta(params: {
    url: string;
    sessionId?: string;
    storeId?: string;
    title?: string;
  }): Promise<any> {
    return this.request('/content/meta', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Enhance a user prompt
   */
  async enhancePrompt(params: {
    brief: string;
    tone?: 'neutral' | 'friendly' | 'professional' | 'playful' | 'bold';
    audience?: string;
    goals?: string[];
    max_words?: number;
    temperature?: number;
    top_p?: number;
  }): Promise<any> {
    return this.request('/seo/enhance', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Generate SEO hints
   */
  async generateHints(params: {
    topic: string;
    style?: 'concise' | 'detailed' | 'technical' | 'story' | 'list';
    include_keywords?: string[];
    avoid?: string[];
    temperature?: number;
    top_p?: number;
  }): Promise<any> {
    return this.request('/seo/hints', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Send chat message
   */
  async sendChatMessage(message: ChatMessage): Promise<ChatResponse> {
    return this.request('/chat/send', {
      method: 'POST',
      body: JSON.stringify(message),
    });
  }

  /**
   * List all chat sessions
   */
  async listSessions(): Promise<any> {
    return this.request('/sessions', {
      method: 'GET',
    });
  }

  /**
   * Get specific session
   */
  async getSession(sessionId: string): Promise<any> {
    return this.request(`/sessions/${sessionId}`, {
      method: 'GET',
    });
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<any> {
    return this.request(`/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  /**
   * List messages for a session
   */
  async listMessages(sessionId: string): Promise<any> {
    return this.request(`/sessions/${sessionId}/messages`, {
      method: 'GET',
    });
  }
}

export default AIServiceClient;
