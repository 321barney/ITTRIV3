// src/ai/types.ts
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface ChatOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  message: {
    role: 'assistant';
    content: string;
  };
}

export interface GenerateResponse {
  response: string;
  done: boolean;
}

export interface EmbeddingsResponse {
  embeddings: number[][];
}

export interface StreamChunk {
  message?: {
    content: string;
  };
  response?: string;
  done?: boolean;
}

export interface LLMClient {
  chat(args: {
    model?: string;
    messages: ChatMessage[];
    stream?: boolean;
    options?: ChatOptions;
  }): Promise<ChatResponse | AsyncIterable<StreamChunk>>;

  generate(args: {
    model?: string;
    prompt: string;
    stream?: boolean;
    options?: ChatOptions;
  }): Promise<GenerateResponse | AsyncIterable<StreamChunk>>;

  embeddings(args: {
    model?: string;
    input: string | string[];
  }): Promise<EmbeddingsResponse>;

  __ping?(): Promise<boolean>;
}
