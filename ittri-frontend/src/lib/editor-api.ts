// src/lib/editor-api.ts
export type EditorFile = {
  id: string;
  name: string;
  path?: string | null;
  kind: 'code' | 'document' | 'asset' | 'prompt';
  metadata?: Record<string, any>;
  updated_at?: string;
  created_at?: string;
};

export type EditorVersion = {
  id: string;
  file_id: string;
  version: number;
  content: string;
  created_at: string;
  metadata?: Record<string, any>;
};

function headers() {
  return { 'content-type': 'application/json' };
}

export async function listFiles(): Promise<EditorFile[]> {
  const res = await fetch('/api/v1/editor/files', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to list files');
  const j = await res.json();
  return j.files || [];
}

export async function createFile(name: string, content: string, kind: EditorFile['kind'] = 'code', path?: string) {
  const res = await fetch('/api/v1/editor/files', {
    method: 'POST',
    credentials: 'include',
    headers: headers(),
    body: JSON.stringify({ name, path, kind, content }),
  });
  if (!res.ok) throw new Error('Failed to create file');
  const j = await res.json();
  return j.file as EditorFile;
}

export async function getFile(id: string): Promise<{file: EditorFile, version: EditorVersion}> {
  const res = await fetch(`/api/v1/editor/files/${id}`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to retrieve file');
  return res.json();
}

export async function saveFile(id: string, content: string, patch?: Partial<EditorFile>) {
  const res = await fetch(`/api/v1/editor/files/${id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: headers(),
    body: JSON.stringify({ ...(patch || {}), content }),
  });
  if (!res.ok) throw new Error('Failed to save file');
  return res.json();
}

export async function listVersions(id: string): Promise<EditorVersion[]> {
  const res = await fetch(`/api/v1/editor/files/${id}/versions`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to list versions');
  const j = await res.json();
  return j.versions || [];
}