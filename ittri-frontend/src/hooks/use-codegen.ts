// hooks/use-codegen.ts
import { useState, useCallback } from 'react';

export interface CodegenOptions {
  prompt: string;
  format: 'html' | 'react';
  sections?: string[];
  brand?: { name?: string; primaryColor?: string; font?: string; logoUrl?: string; };
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface CodegenResult {
  html?: string;
  react?: { files: Array<{ path: string; contents: string }> };
  meta?: { format: 'html' | 'react'; model: string; warnings?: string[]; suggestions?: string[]; };
}

export function useCodegen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  const abort = useCallback(() => {
    abortController?.abort();
    setLoading(false);
  }, [abortController]);

  const generate = useCallback(async (options: CodegenOptions): Promise<CodegenResult | null> => {
    setLoading(true); setError(null); setProgress(0);
    const controller = new AbortController(); setAbortController(controller);
    try {
      const body = {
        prompt: options.prompt, format: options.format, sections: options.sections, brand: options.brand, stream: options.stream,
        options: { temperature: options.temperature, max_tokens: options.maxTokens }
      };
      if (!options.stream) {
        // Route through unified dashboard proxy to ensure correct backend path
        const res = await fetch('/api/dashboard/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
      }
      const res = await fetch('/api/dashboard/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/x-ndjson' }, body: JSON.stringify(body), signal: controller.signal });
      if (!res.ok) throw new Error(await res.text());
      const reader = res.body?.getReader(); if (!reader) throw new Error('No body');
      const dec = new TextDecoder(); let buf = ''; let final: CodegenResult | null = null;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const frame = JSON.parse(line);
            if (frame.type === 'progress' && typeof frame.bytes === 'number') setProgress(frame.bytes);
            else if (frame.type === 'final' && frame.data) final = frame.data;
          } catch {}
        }
      }
      return final;
    } catch (e: any) {
      setError(e?.message ?? 'Generation failed'); return null;
    } finally {
      setLoading(false); setAbortController(null);
    }
  }, []);

  return { loading, error, progress, generate, abort };
}
