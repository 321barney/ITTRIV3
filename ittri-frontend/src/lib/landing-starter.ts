export const STREAM_KEY = 'studio.stream.html';
export const FINAL_KEY  = 'studio.latest.html';
export const STATUS_KEY = 'studio.stream.status'; // 'idle' | 'open' | 'done' | 'error'

// Your server route
const API_PATH = '/api/dashboard/generate';

export async function startLandingStream(prompt: string) {
  try {
    localStorage.removeItem(STREAM_KEY);
    localStorage.removeItem(FINAL_KEY);
    localStorage.setItem(STATUS_KEY, 'open');

    const res = await fetch(API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (!res.ok || !res.body) {
      localStorage.setItem(STATUS_KEY, 'error');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      localStorage.setItem(STREAM_KEY, full); // live buffer visible to Studio
    }

    localStorage.setItem(FINAL_KEY, full);
    localStorage.setItem(STATUS_KEY, 'done');
    localStorage.removeItem(STREAM_KEY);
  } catch {
    localStorage.setItem(STATUS_KEY, 'error');
  }
}
