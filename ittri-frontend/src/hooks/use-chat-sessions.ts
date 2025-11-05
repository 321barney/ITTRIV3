// hooks/use-chat-sessions.ts
//
// A React hook that manages chat sessions persisted on the backend. Instead
// of storing conversations in localStorage, it fetches and creates sessions
// via the AI hub API. Messages are loaded lazily on demand, and chat
// requests hit the backend to obtain assistant replies.

import { useState, useEffect } from 'react';
import { useUser } from '@/stores/user-store';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  status?: string;
}

/**
 * Returns the base URL for the backend. In a browser context, when the
 * configured API URL points at localhost, this function rewrites it to
 * relative `/api` to allow proxying through Next.js API routes.
 */
function getApiBase() {
  // In the browser we prefer to route through Next.js API proxies when the
  // configured API URL is empty or points to localhost. This allows us to
  // automatically attach identity headers via server-side code. When a
  // NEXT_PUBLIC_API_URL is provided and is not localhost, we talk to the
  // backend directly on its /api/v1/ai prefix. The trailing slash is
  // trimmed to avoid duplicating path segments.
  let envBase = (process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_BASE || '').trim();
  envBase = envBase.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    const isEmpty   = !envBase;
    const isLocal   = /^https?:\/\/localhost(:\d+)?$/i.test(envBase);
    if (isEmpty || isLocal) {
      // Use the Next.js dashboard API routes (e.g. /api/dashboard/sessions) when
      // running locally. These proxies will forward identity cookies and
      // headers correctly.
      return '/api/dashboard';
    }
  }
  // For non-local deployments, talk to the backend directly.
  return envBase ? `${envBase}/api/v1/ai` : '/api/dashboard';
}

/**
 * A hook that encapsulates chat session CRUD and messaging. It provides
 * functions to refresh the session list, create a new session, fetch messages
 * for a session, and send a chat message. All network requests are made via
 * the AI hub endpoints.
 */
export function useChatSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Current authenticated user (seller). When present, we include
  // their identity in request headers so the backend can resolve
  // req.user via x-org-identity. If null, the endpoints may return
  // unauthorized.
  const user = useUser();

  /**
   * Construct common headers for outbound AI requests. If a user is present,
   * the x-org-identity header is set to a JSON string with sellerId and email.
   */
  function buildHeaders(contentType?: string): HeadersInit {
    const headers: HeadersInit = {};
    if (contentType) headers['Content-Type'] = contentType;
    if (user?.id) {
      try {
        headers['x-org-identity'] = JSON.stringify({ sellerId: user.id, email: user.email });
      } catch {}
    }
    return headers;
  }

  // Load sessions on mount
  useEffect(() => {
    refreshSessions().catch((err) => console.error('Failed to refresh sessions', err));
  }, []);

  /**
   * Fetch the list of sessions from the backend and update local state.
   */
  async function refreshSessions() {
    const base = getApiBase();
    const res = await fetch(`${base}/sessions`, {
      method: 'GET',
      credentials: 'include',
      headers: buildHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch sessions: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (data.ok) setSessions(data.sessions);
  }

  /**
   * Create a new chat session. Optionally specify a title. Upon success, the
   * session list is refreshed and the newly created session is selected.
   */
  async function createSession(title?: string, storeId?: string | null) {
    const base = getApiBase();
    const payload: any = {};
    if (title) payload.title = title;
    if (storeId) payload.storeId = storeId;
    const res = await fetch(`${base}/sessions`, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders('application/json'),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Failed to create session: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (data.ok && data.id) {
      await refreshSessions();
      setCurrentSessionId(data.id);
      return data.id as string;
    }
    throw new Error('Failed to create session');
  }

  /**
   * Fetch messages for a given session ID. Returns an array of chat messages
   * ordered chronologically. The session must already exist on the backend.
   */
  async function fetchMessages(sessionId: string): Promise<ChatMessage[]> {
    const base = getApiBase();
    const res = await fetch(`${base}/messages/${sessionId}`, {
      method: 'GET',
      credentials: 'include',
      headers: buildHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch messages: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (data.ok) {
      return (data.messages as any[]).map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: Number(m.timestamp),
      })) as ChatMessage[];
    }
    return [];
  }

  /**
   * Send a chat message. Optionally pass an existing session ID to continue
   * within that session. If no session ID is provided, a new session is
   * implicitly created. The optional `updateNeed` parameter will update the
   * session's user_need metadata on the backend. Returns the assistant's
   * reply as text. Streaming is disabled by default; streaming mode can be
   * enabled by passing true as the third argument.
   */
  async function sendChat(opts: { sessionId?: string | null; message: string; updateNeed?: string | null; stream?: boolean; storeId?: string | null; }): Promise<{ sessionId: string; reply: string; } | void> {
    const base = getApiBase();
    const { sessionId, message, updateNeed, stream = false, storeId } = opts;
    const payload: any = { message, stream: !!stream };
    if (sessionId) payload.sessionId = sessionId;
    if (storeId) payload.storeId = storeId;
    if (updateNeed) payload.updateNeed = updateNeed;
    const res = await fetch(`${base}/chat/send`, {
      method: 'POST',
      credentials: 'include',
      headers: buildHeaders('application/json'),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Failed to send chat: ${res.status} ${res.statusText}`);
    }
    // If streaming, the caller should handle the NDJSON stream directly. This
    // helper only supports non-streaming replies. The backend will return a
    // JSON payload with the sessionId and reply text.
    if (stream) {
      // For streaming, the consumer should use fetch() directly with `stream:true`.
      return;
    }
    const data = await res.json();
    if (data.ok) {
      return { sessionId: data.sessionId as string, reply: data.reply as string };
    }
    throw new Error('Failed to send chat');
  }

  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  return {
    sessions,
    currentSession,
    currentSessionId,
    setCurrentSessionId,
    refreshSessions,
    createSession,
    fetchMessages,
    sendChat,
  };
}