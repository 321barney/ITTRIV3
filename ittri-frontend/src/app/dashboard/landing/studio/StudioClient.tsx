"use client";

import * as EditorAPI from "@/lib/editor-api";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  X, MessageSquarePlus, ExternalLink, Download, Upload, RotateCcw, RefreshCw, Save, Sparkles, Settings,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast.ts";

export type StudioFile = { id?: string; name: string; content: string };
type StatusKind = "active" | "pending" | "inactive";
type ActiveTab = { kind: "file"; index: number } | { kind: "chat" };
type ChatItem = { id: string; role: "user" | "assistant"; text: string; at: number };

// ── constants
const STORAGE_PREFIX = "ittri.editor";
const ORIGINAL_CONTENT_KEY = "ittri.original";
const GENERATE_API = "/api/v1/ai/generate";
const CHAT_SEND_API = "/api/v1/ai/chat/send";
const CHAT_MESSAGES_API = (sid: string) => `/api/v1/ai/messages/${sid}`;
const CHAT_SESSIONS_API = "/api/v1/ai/sessions";

export default function Studio() {
  const { toast } = useToast();

  // files (kept in localStorage – ONLY for editor files, not chat)
  const [files, setFiles] = useState<StudioFile[]>(() => {
    const fallback = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>ittri — Live Preview</title><style>:root{color-scheme:dark light}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Inter,Roboto,'SF Pro Display';background:hsl(var(--background));color:hsl(var(--foreground));min-height:100vh;display:flex;align-items:center;justify-content:center}.wrap{text-align:center;padding:2rem}</style></head><body><div class="wrap"><h1 class="gradient-text-triple">ittri</h1><p>Dynamic preview mirrors your code instantly ✨</p></div></body></html>`;
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}.index.html`);
      if (!localStorage.getItem(`${ORIGINAL_CONTENT_KEY}.index.html`)) {
        localStorage.setItem(`${ORIGINAL_CONTENT_KEY}.index.html`, fallback);
      }
      return [{ name: "index.html", content: saved || fallback }];
    }
    return [{ name: "index.html", content: fallback }];
  });

  // Map of file name -> server id
  const [serverIds, setServerIds] = useState<Record<string,string>>({});

  // Initial sync from server to populate editor and map ids
  useEffect(() => {
    (async () => {
      try {
        const list = await EditorAPI.listFiles();
        const nextFiles: StudioFile[] = [...files];
        const idMap: Record<string,string> = { ...serverIds };
        for (const f of list) {
          try {
            const { version } = await EditorAPI.getFile(f.id);
            const name = f.name || 'untitled';
            const content = version?.content || '';
            const existingIdx = nextFiles.findIndex(ff => ff.name === name);
            if (existingIdx >= 0) { nextFiles[existingIdx] = { id: f.id, name, content }; }
            else { nextFiles.push({ id: f.id, name, content }); }
            idMap[name] = f.id;
            // cache locally too for offline
            try { localStorage.setItem(`${STORAGE_PREFIX}.${name}`, content); } catch {}
          } catch {}
        }
        setFiles(nextFiles);
        setServerIds(idMap);
      } catch (e) { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const [active, setActive] = useState<ActiveTab>({ kind: "file", index: 0 });
  const currentFile = useMemo(() => (active.kind === "file" ? files[active.index] ?? null : null), [active, files]);

  // ── chat (NO localStorage)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chat, setChat] = useState<ChatItem[]>([]);

  async function pickOrCreateSession(fileId?: string): Promise<string> {
    // If fileId is provided, try to load file-specific sessions first
    if (fileId) {
      try {
        const res = await fetch(`${CHAT_SESSIONS_API}/by-file/${fileId}`, {
          method: "GET",
          credentials: "include",
          headers: { accept: "application/json" },
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const list = Array.isArray(data?.sessions) ? data.sessions : Array.isArray(data) ? data : [];
          if (Array.isArray(list) && list.length) {
            // Use the most recent file-specific session
            return String(list[0]?.id || "");
          }
        }
      } catch {}
      
      // Create a new file-specific session
      try {
        const res2 = await fetch(CHAT_SESSIONS_API, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ fileId, title: `Chat: ${currentFile?.name || 'File'}` }),
        });
        const data2 = await res2.json().catch(() => ({}));
        const sid = String(data2?.id || data2?.sessionId || data2?.session_id || "");
        if (sid) return sid;
      } catch {}
    }
    
    // 1) Try to pick an existing session (latest or title match)
    try {
      const res = await fetch(CHAT_SESSIONS_API, {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const list = Array.isArray(data?.sessions) ? data.sessions : Array.isArray(data) ? data : [];
        if (Array.isArray(list) && list.length) {
          // prefer a prior "Studio Chat", else latest
          const studio = list.find((s: any) => /studio chat/i.test(String(s?.title || "")));
          const chosen = studio || list[0];
          if (chosen?.id) return String(chosen.id);
        }
      }
    } catch {}

    // 2) Create one
    const res2 = await fetch(CHAT_SESSIONS_API, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ title: "Studio Chat", ...(fileId ? { fileId } : {}) }),
    });
    const data2 = await res2.json().catch(() => ({}));
    const sid = String(data2?.id || data2?.sessionId || data2?.session_id || "");
    if (!sid) throw new Error("Failed to create chat session");
    return sid;
  }

  async function ensureSession(): Promise<string> {
    // If we have a current file with an ID, use it for context
    const fileId = currentFile?.id || null;
    if (sessionId && !fileId) return sessionId;
    
    // If file context changed, reload session for that file
    const sid = await pickOrCreateSession(fileId || undefined);
    setSessionId(sid);
    return sid;
  }

  async function loadChatFromDB(sid: string) {
    try {
      const res = await fetch(CHAT_MESSAGES_API(sid), {
        credentials: "include",
        headers: { accept: "application/json", "x-chat-session-id": sid },
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      const rows = Array.isArray(data) ? data : (data?.messages ?? []);
      if (!Array.isArray(rows)) return;
      const items: ChatItem[] = rows.map((m: any) => ({
        id: String(m.id || m.timestamp || Math.random()),
        role: m.role === "system" ? "assistant" : (m.role as "user" | "assistant"),
        text: m.content ?? m.text ?? "",
        at: Number(m.timestamp || Date.now()),
      }));
      setChat(items);
      setChatEnabled(items.length > 0);
    } catch {}
  }

  // Load chat when file changes (per-file conversations)
  useEffect(() => {
    (async () => {
      try {
        const sid = await ensureSession();
        await loadChatFromDB(sid);
      } catch {
        // not logged in or backend declined; chat stays off until first send
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFile?.id]); // Reload chat when file context changes

  // poll for replies when we have a session
  useEffect(() => {
    if (!sessionId) return;
    const t = setInterval(() => loadChatFromDB(sessionId), 4000);
    return () => clearInterval(t);
  }, [sessionId]);

  // ── status/save (for files only)
  const [status, setStatus] = useState<{ text: string; kind: StatusKind }>({ text: "Ready", kind: "active" });
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const linesRef = useRef<HTMLDivElement | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isSave = (e.key === "s" || e.key === "S") && (e.ctrlKey || e.metaKey);
      if (!isSave) return;
      e.preventDefault();
      try {
        if (currentFile) {
          const key = `${STORAGE_PREFIX}.${currentFile.name}`;
          localStorage.setItem(key, currentFile.content ?? "");
          setLastSaved(new Date());
          setStatus({ text: "Saved", kind: "active" });
        }
      } catch {}
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentFile]);

  // ── generate state
  const [isGenerating, setIsGenerating] = useState(false);
  const [genPrompt, setGenPrompt] = useState<string>("Improve the structure and modernize the markup.");
  const [isPromptDialogOpen, setIsPromptDialogOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── setup dialog
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [setupFileName, setSetupFileName] = useState("index.html");
  const [setupTitle, setSetupTitle] = useState("ittri — Live Preview");
  const [setupFormat, setSetupFormat] = useState<"html" | "react">("html");
  const [setupTemplate, setSetupTemplate] = useState<"blank" | "landing-simple" | "landing-portfolio" | "landing-blog" | "landing-launch">("blank");
  const [replaceContent, setReplaceContent] = useState(false);
  const [formatOverride, setFormatOverride] = useState<"html" | "react" | null>(null);

  const lineCount = useMemo(() => (active.kind === "file" ? files[active.index].content.split("\n").length : 0), [active, files]);

  // helpers
  function stripCodeFences(input: string): string {
    try { return input.replace(/^\s*```(?:html|htm)?\s*/i, "").replace(/\s*```\s*$/i, ""); } catch { return input; }
  }
  const inferFormat = (name: string): "html" | "react" => (/\.(tsx|jsx)$/i.test(name) ? "react" : "html");

  // preview
  const srcDoc = useMemo(() => {
    const file = currentFile ?? files[0];
    const raw = file?.content ?? "";
    const content = stripCodeFences(raw);
    const isHTML =
      (file?.name || "").toLowerCase().endsWith(".html") ||
      content.trim().toLowerCase().startsWith("<!doctype html") ||
      content.trim().toLowerCase().startsWith("<html");

    const themeVars = (() => {
      if (typeof window === "undefined") return "";
      try {
        const style = getComputedStyle(document.documentElement);
        const keys = ["--background","--foreground","--foreground-rgb","--muted-foreground-rgb","--border-rgb","--primary-rgb","--destructive-rgb","--ring-rgb"];
        const entries = keys.map(k => {
          const v = style.getPropertyValue(k).trim();
          return v ? `${k}:${v}` : "";
        }).filter(Boolean).join(";");
        return "<style>:root{"+entries+"}body{background:hsl(var(--background));color:hsl(var(--foreground));font-family:system-ui,-apple-system,Segoe UI,Inter,Roboto,'SF Pro Display'}</style>";
      } catch { return ""; }
    })();

    if (isHTML) {
      let html = content;
      const headOpen = /<head[^>]*>/i;
      const tailwindCDN = '<script src="https://cdn.tailwindcss.com"></script><script>tailwind.config={darkMode:"class"}</script>';
      const themeInject = themeVars + '<script>(function(){try{var hasDark=(parent&&parent.document&&parent.documentElement.classList.contains("dark"));document.documentElement.classList.toggle("dark",hasDark);if(parent&&parent.document){new MutationObserver(function(){var h=parent.document.documentElement.classList.contains("dark");document.documentElement.classList.toggle("dark",h);}).observe(parent.documentElement,{attributes:true,attributeFilter:["class"]});}}catch(e){}})();</script>';
      if (headOpen.test(html)) {
        html = html.replace(headOpen, m => m + themeInject + tailwindCDN);
      } else {
        html = '<!doctype html><html><head>' + themeInject + tailwindCDN + '</head><body>' + html + '</body></html>';
      }
      return html;
    }
    const escaped = content.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" } as any)[c] || c);
    return '<!doctype html><html><head><meta charset="utf-8"/><title>Preview</title>'+themeVars+'</head><body><h1 style="font:600 16px system-ui">Preview (content is not full HTML)</h1><pre style="white-space:pre-wrap;word-break:break-word;padding:24px;margin:0">'+escaped+"</pre></body></html>";
  }, [currentFile, files]);

  // line numbers + scroll sync
  const updateLineNumbers = () => {
    const editor = editorRef.current;
    const lines = editor?.value.split("\n").length ?? 1;
    if (linesRef.current) linesRef.current.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  };
  useEffect(() => {
    const ed = editorRef.current;
    const onScroll = () => { if (!ed || !linesRef.current) return; linesRef.current.scrollTop = ed.scrollTop; };
    ed?.addEventListener("scroll", onScroll);
    return () => ed?.removeEventListener("scroll", onScroll);
  }, [currentFile?.name]);

  // debounced auto-save (files only)
  useEffect(() => {
    if (!currentFile) return;
    setIsSaving(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(`${STORAGE_PREFIX}.${currentFile.name}`, currentFile.content);
        setLastSaved(new Date());
        setIsSaving(false);
        setStatus({ text: "Saved", kind: "active" });
        // server sync
        (async () => {
          try {
            const name = currentFile.name;
            const id = serverIds[name];
            if (id) {
              await EditorAPI.saveFile(id, currentFile.content);
            } else {
              const created = await EditorAPI.createFile(name, currentFile.content);
              setServerIds(prev => ({ ...prev, [name]: created.id }));
              // attach id to local file object
              const idx = files.findIndex(f => f.name === name);
              if (idx >= 0) {
                const cp = files.slice(); cp[idx] = { ...cp[idx], id: created.id };
                setFiles(cp);
              }
            }
          } catch (e) { /* non-blocking */ }
        })();
      } catch {
        setIsSaving(false);
        setStatus({ text: "Save Failed", kind: "inactive" });
        toast({ title: "Save Failed", description: "Could not save file to local storage", variant: "destructive" });
      }
    }, 800);
    return () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); };
  }, [currentFile?.content, currentFile?.name, toast]);

  // file helpers
  const setFileContent = (index: number, content: string) =>
    setFiles(prev => { const out = [...prev]; out[index] = { ...out[index], content }; return out; });
  const addNewFile = (fname: string) => {
    const name = fname.trim();
    if (!name) return toast({ title: "Invalid Filename", variant: "destructive" });
    if (files.some(f => f.name === name)) return toast({ title: "File Exists", description: name, variant: "destructive" });
    setFiles(prev => [...prev, { name, content: "" }]);
    try { localStorage.setItem(`${ORIGINAL_CONTENT_KEY}.${name}`, ""); } catch {}
    setActive({ kind: "file", index: files.length });
    requestAnimationFrame(updateLineNumbers);
  };
  const closeFile = (index: number) => {
    if (files.length === 1) return toast({ title: "Cannot Close", description: "Keep at least one file", variant: "destructive" });
    const fileName = files[index].name;
    setFiles(prev => prev.filter((_, i) => i !== index));
    setActive(prev => (prev.kind === "file" ? (prev.index === index ? { kind: "file", index: Math.max(0, index - 1) } : prev.index > index ? { kind: "file", index: prev.index - 1 } : prev) : prev));
    toast({ title: "File Closed", description: fileName });
  };
  const downloadFile = () => {
    const file = currentFile; if (!file) return;
    try {
      const blob = new Blob([file.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = file.name; document.body.append(a);
      requestAnimationFrame(() => {
        try { a.click(); } catch {}
        queueMicrotask(() => { try { a.remove(); } catch {}; try { URL.revokeObjectURL(url); } catch {}; });
      });
      toast({ title: "Download Started", description: file.name });
    } catch { toast({ title: "Download Failed", variant: "destructive" }); }
  };
  const uploadFile = () => {
    const input = document.createElement("input"); input.type = "file"; input.accept = ".html,.css,.js,.txt,.json,.md,.tsx,.jsx";
    input.onchange = async e => {
      const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return;
      try {
        const content = await file.text(); const fileName = file.name;
        const existingIndex = files.findIndex(f => f.name === fileName);
        if (existingIndex !== -1) { setFileContent(existingIndex, content); setActive({ kind: "file", index: existingIndex }); toast({ title: "File Updated", description: fileName }); }
        else { setFiles(prev => [...prev, { name: fileName, content }]); try { localStorage.setItem(`${ORIGINAL_CONTENT_KEY}.${fileName}`, content); } catch {} setActive({ kind: "file", index: files.length }); toast({ title: "File Uploaded", description: fileName }); }
      } catch { toast({ title: "Upload Failed", variant: "destructive" }); }
    };
    input.click();
  };
  const resetFile = () => {
    if (!currentFile) return;
    const original = localStorage.getItem(`${ORIGINAL_CONTENT_KEY}.${currentFile.name}`);
    if (original !== null) { setFileContent(active.kind === "file" ? active.index : 0, original); toast({ title: "File Reset", description: currentFile.name }); }
    else { toast({ title: "No Original Content", variant: "destructive" }); }
  };

  // preview refresh
  const [previewKey, setPreviewKey] = useState(0);
  const refreshPreview = () => { setPreviewKey(p => p + 1); toast({ title: "Preview Refreshed" }); };

  // chat helpers
  const addChatTab = () => { setChatEnabled(true); setActive({ kind: "chat" }); };
  const removeChatTab = () => { setChatEnabled(false); setActive({ kind: "file", index: 0 }); };

  const sendChat = async (text: string) => {
    const trimmed = text.trim(); if (!trimmed) return;

    const optimistic: ChatItem = { id: crypto.randomUUID(), role: "user", text: trimmed, at: Date.now() };
    setChat(prev => [...prev, optimistic]); setChatEnabled(true);

    let sid: string;
    try { sid = await ensureSession(); }
    catch (err: any) {
      toast({ title: "Chat Error", description: String(err?.message || err), variant: "destructive" });
      return;
    }

    try {
      const res = await fetch(CHAT_SEND_API, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          "x-chat-session-id": sid,
        },
        body: JSON.stringify({ sessionId: sid, message: trimmed, store: true, stream: false }),
      });

      const txt = await res.text().catch(() => "");
      let returned: any = {};
      try { returned = txt ? JSON.parse(txt) : {}; } catch {}

      const returnedSid = returned?.sessionId || returned?.session_id || returned?.id;
      if (returnedSid && String(returnedSid) !== sid) {
        sid = String(returnedSid);
        setSessionId(sid);
      }

      if (!res.ok) throw new Error(returned?.error || `Failed to send message (${res.status})`);
      await loadChatFromDB(sid);
    } catch (err: any) {
      toast({ title: "Chat Error", description: String(err?.message || err), variant: "destructive" });
    }
  };

  // setup helpers (files)
  const sanitizeFileName = (v: string) => v.trim().replace(/\s+/g, "-");
  const extractHtmlTitle = (html: string) => { const m = html.match(/<title>(.*?)<\/title>/i); return m ? m[1].trim() : ""; };
  const ensureExtensionForFormat = (name: string, fmt: "html" | "react") => {
    const low = name.toLowerCase();
    if (fmt === "html") return low.endsWith(".html") ? name : `${name.replace(/\.(tsx|jsx)$/i, "")}.html`;
    return low.endsWith(".tsx") || low.endsWith(".jsx") ? name : `${name.replace(/\.html?$/i, "")}.tsx`;
  };
  const buildTemplate = (kind: "blank" | "landing-simple" | "landing-portfolio" | "landing-blog" | "landing-launch", fmt: "html" | "react", title: string) => {
    if (fmt === "react") {
      if (kind === "landing-simple") return `import React from "react";export default function Landing(){return(<main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center"><section className="max-w-2xl p-8 text-center"><h1 className="text-4xl font-bold mb-2">${title||"Cosmic Product"}</h1><p className="opacity-80 mb-6">A sleek landing page starter built with React + Tailwind.</p><div className="flex gap-3 justify-center"><a className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20" href="#">Learn more</a><a className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500" href="#">Get started</a></div></section></main>);}`;
      if (kind === "landing-portfolio") return `import React from "react";export default function Portfolio(){return(<main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-12"><section className="max-w-4xl mx-auto text-center mb-12"><h1 className="text-4xl font-bold mb-2">${title||"My Portfolio"}</h1><p className="opacity-80">Showcase of selected projects and achievements.</p></section><div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto"><div className="p-4 rounded-xl bg-white/5"><h2 className="text-lg font-semibold mb-2">Project 1</h2><p className="text-sm opacity-75">Description of project one.</p></div><div className="p-4 rounded-xl bg-white/5"><h2 className="text-lg font-semibold mb-2">Project 2</h2><p className="text-sm opacity-75">Description of project two.</p></div><div className="p-4 rounded-xl bg-white/5"><h2 className="text-lg font-semibold mb-2">Project 3</h2><p className="text-sm opacity-75">Description of project three.</p></div></div></main>);}`;
      if (kind === "landing-blog") return `import React from "react";export default function Blog(){return(<main className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-12"><section className="max-w-3xl mx-auto text-center mb-12"><h1 className="text-4xl font-bold mb-2">${title||"My Blog"}</h1><p className="opacity-80">Thoughts, tutorials and stories.</p></section><div className="space-y-8 max-w-3xl mx-auto"><article className="p-6 rounded-xl bg-white/5"><h2 className="text-2xl font-semibold mb-1">Post Title</h2><p className="text-sm opacity-75">A short preview of the post content...</p></article><article className="p-6 rounded-xl bg-white/5"><h2 className="text-2xl font-semibold mb-1">Another Post</h2><p className="text-sm opacity-75">Another short preview of the post content...</p></article></div></main>);}`;
      if (kind === "landing-launch") return `import React from "react";export default function Launch(){return(<main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center"><section className="text-center p-8"><h1 className="text-4xl font-bold mb-2">${title||"Coming Soon"}</h1><p className="opacity-80 mb-6">We are working hard. Stay tuned!</p><form className="max-w-xs mx-auto flex"><input type="email" placeholder="Your email" className="flex-1 p-3 rounded-l-md bg-white/10 text-neutral-100 focus:outline-none"/><button className="px-4 py-3 rounded-r-md bg-indigo-600 hover:bg-indigo-500">Notify me</button></form></section></main>);}`;
      return `export default function Page(){return <div>${title||"New Page"}</div>}`;
    }
    if (kind === "landing-simple") return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title||"Cosmic Product"}</title><style>body{margin:0;background:#0b0b0d;color:#e5e7eb;font:16px/1.5 ui-sans-serif,system-ui}.wrap{min-height:100svh;display:grid;place-items:center}.card{max-width:720px;padding:40px;text-align:center;margin:auto}.cta{display:inline-block;padding:10px 16px;border-radius:12px;background:#6366f1;color:#fff;text-decoration:none}</style></head><body><div class="wrap"><section class="card"><h1 style="font-size:clamp(2rem,4vw,3rem);margin:0 0 8px">${title||"Cosmic Product"}</h1><p style="opacity:.8;margin:0 0 20px">A minimal, responsive landing starter.</p><a class="cta" href="#">Get Started</a></section></div></body></html>`;
    if (kind === "landing-portfolio") return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title||"My Portfolio"}</title><style>body{margin:0;background:#0b0b0d;color:#e5e7eb;font:16px/1.5 ui-sans-serif,system-ui}.wrap{padding:40px;text-align:center}.grid{display:grid;grid-template-columns:1fr;gap:20px}.card{padding:20px;border-radius:12px;background:#16181d;color:#f5f5f5}</style></head><body><div class="wrap"><h1 style="font-size:clamp(2rem,4vw,3rem);margin-bottom:8px">${title||"My Portfolio"}</h1><p style="opacity:.8;margin-bottom:20px">Showcase of selected projects.</p><div class="grid"><div class="card"><h2>Project 1</h2><p>Description of project one.</p></div><div class="card"><h2>Project 2</h2><p>Description of project two.</p></div><div class="card"><h2>Project 3</h2><p>Description of project three.</p></div></div></div></body></html>`;
    if (kind === "landing-blog") return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title||"My Blog"}</title><style>body{margin:0;background:#0b0b0d;color:#e5e7eb;font:16px/1.5 ui-sans-serif,system-ui}.wrap{padding:40px;text-align:center}.post{padding:24px;border-radius:12px;background:#16181d;color:#f5f5f5;margin-bottom:24px}</style></head><body><div class="wrap"><h1 style="font-size:clamp(2rem,4vw,3rem);margin-bottom:12px">${title||"My Blog"}</h1><p style="opacity:.8;margin-bottom:24px">Thoughts, tutorials and stories.</p><div class="post"><h2>Post Title</h2><p>A short preview of the post content...</p></div><div class="post"><h2>Another Post</h2><p>Another short preview of the post content...</p></div></div></body></html>`;
    if (kind === "landing-launch") return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title||"Coming Soon"}</title><style>body{margin:0;background:#0b0b0d;color:#e5e7eb;font:16px/1.5 ui-sans-serif,system-ui;display:flex;align-items:center;justify-content:center;height:100vh}.container{text-align:center;padding:24px}.form{display:flex;margin-top:24px}.form input{flex:1;padding:12px;border:0;border-radius:6px 0 0 6px;background:#2b2e34;color:#e5e7eb}.form button{padding:12px 20px;border:0;border-radius:0 6px 6px 0;background:#6366f1;color:#fff;cursor:pointer}</style></head><body><div class="container"><h1 style="font-size:clamp(2rem,4vw,3rem);margin-bottom:12px">${title||"Coming Soon"}</h1><p style="opacity:.8;margin-bottom:24px">We are working hard. Stay tuned!</p><div class="form"><input type="email" placeholder="Your email" /><button>Notify me</button></div></div></body></html>`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title||"New Page"}</title></head><body></body></html>`;
  };

  const openSetup = () => {
    const file = currentFile ?? files[0];
    setSetupFileName(file?.name || "index.html");
    setSetupFormat(inferFormat(file?.name || "index.html"));
    setSetupTitle(file?.name.endsWith(".html") ? extractHtmlTitle(file?.content || "") || "ittri — Live Preview" : "ittri — Live Preview");
    setReplaceContent(false);
    setSetupTemplate("blank");
    setIsSetupOpen(true);
  };

  const applySetup = () => {
    if (!currentFile) return;
    const targetFmt = setupFormat;
    const desiredName = ensureExtensionForFormat(sanitizeFileName(setupFileName || "index"), targetFmt);
    const existsAt = files.findIndex(f => f.name === desiredName);
    const currentIndex = active.kind === "file" ? active.index : 0;
    if (existsAt !== -1 && existsAt !== currentIndex) {
      toast({ title: "File Exists", description: `A file named "${desiredName}" already exists.`, variant: "destructive" });
      return;
    }
    const nextFiles = [...files];
    const next = { ...nextFiles[currentIndex] };
    if (next.name !== desiredName) next.name = desiredName;
    if (replaceContent) {
      next.content = buildTemplate(setupTemplate, targetFmt, setupTitle);
      try { localStorage.setItem(`${ORIGINAL_CONTENT_KEY}.${desiredName}`, next.content); } catch {}
    }
    nextFiles[currentIndex] = next;
    setFiles(nextFiles);
    setActive({ kind: "file", index: currentIndex });
    setFormatOverride(targetFmt);
    setIsSetupOpen(false);
    toast({ title: "Page configured", description: `${desiredName} • ${targetFmt.toUpperCase()}` });
  };

  // ── generation (uses session in memory only)
  const startGenerate = async () => {
    if (!currentFile) return toast({ title: "No file open", variant: "destructive" });

    let sid = "";
    try { sid = await ensureSession(); } catch {}

    try { if (genPrompt.trim()) await sendChat(genPrompt); } catch {}

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);
    setStatus({ text: "Generating…", kind: "pending" });

    const payload = {
      mode: "code",
      prompt: genPrompt,
      source: currentFile.content,
      input: currentFile.content,
      fileName: currentFile.name,
      format: (formatOverride ?? inferFormat(currentFile.name)),
      stream: true,
      sessionId: sid || undefined,
      session_id: sid || undefined,
      store: !!sid,
      fileId: currentFile.id || undefined, // Associate generation with file context
    };

    try {
      const res = await fetch(GENERATE_API, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/x-ndjson, application/json, text/plain, */*",
          "x-chat-session-id": sid || "",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}\n${await res.text().catch(()=>"")}`);

      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      const isStreamy = ctype.includes("text/event-stream") || ctype.includes("ndjson") || ctype.includes("application/x-ndjson") || ctype.startsWith("text/") || ctype === "";

      if (res.body && isStreamy) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let assembled = "";

        const apply = (delta: string) => {
          if (!delta) return;
          assembled += delta;
          if (active.kind === "file") setFileContent(active.index, assembled);
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            let line = buf.slice(0, nl).replace(/\r$/, "");
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;

            if (ctype.includes("text/event-stream")) {
              const m = line.match(/^data:\s*(.*)$/i);
              if (m) line = m[1];
              if (line.trim() === "[DONE]") continue;
            }

            try {
              const evt = JSON.parse(line) as any;
              if (evt?.error) throw new Error(evt.error);

              if (typeof evt?.type === "string") {
                if (evt.type === "progress") continue;
                if (evt.type === "final") {
                  const sid2 = (evt.sessionId || evt.session_id) as string | undefined;
                  if (sid2 && sid2 !== sid) { sid = sid2; setSessionId(sid2); }
                  const data = evt.data ?? {};
                  let out = "";
                  if (data?.html) out = String(data.html);
                  else if (data?.react?.files?.[0]?.contents) out = String(data.react.files[0].contents);
                  else if (typeof data?.content === "string") out = data.content;
                  if (active.kind === "file") setFileContent(active.index, out);
                  assembled = out;
                  try { sendChat(`AI updated ${currentFile?.name || "your page"}`); } catch {}
                  buf = "";
                  continue;
                }
              }

              const delta =
                (typeof evt?.delta === "string" && evt.delta) ||
                (typeof evt?.content === "string" && evt.content) ||
                (typeof evt?.text === "string" && evt.text) ||
                "";

              if (delta) apply(delta);
              else apply(line + "\n");
            } catch {
              apply(line + "\n");
            }
          }
        }
        if (buf.trim()) apply(buf);
      } else if (ctype.includes("application/json")) {
        const data = await res.json().catch(() => ({}));
        const sid2 = (data?.sessionId || data?.session_id) as string | undefined;
        if (sid2 && sid2 !== sid) { sid = sid2; setSessionId(sid2); }
        const out = data?.content ?? data?.html ?? data?.result ?? data?.text ?? "";
        if (!out) throw new Error("Empty response from generator");
        if (active.kind === "file") setFileContent(active.index, out);
      } else {
        const txt = await res.text();
        if (active.kind === "file") setFileContent(active.index, txt || "(empty)");
      }

      setStatus({ text: "Ready", kind: "active" });
      toast({ title: "Generation complete" });
      if (sid) await loadChatFromDB(sid);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setStatus({ text: "Cancelled", kind: "inactive" });
        toast({ title: "Generation cancelled" });
      } else {
        const msg = String(err?.message || err);
        setStatus({ text: "Error", kind: "inactive" });
        toast({ title: "Generation failed", description: msg, variant: "destructive" });
        if (active.kind === "file") setFileContent(active.index, `/* Generation failed */\n${msg}\n`);
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  };
  const cancelGenerate = () => abortRef.current?.abort();

  // ui state
  const [newFileName, setNewFileName] = useState("");
  const [isAddFileDialogOpen, setIsAddFileDialogOpen] = useState(false);

  // layout drag
  const [leftWidthPct, setLeftWidthPct] = useState(56);
  const draggingRef = useRef(false);
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const total = window.innerWidth; const nextPct = Math.min(75, Math.max(35, (e.clientX / total) * 100));
      setLeftWidthPct(nextPct);
    };
    const onUp = () => (draggingRef.current = false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  return (
    <>
      <div className="relative flex min-h-screen overflow-hidden">
        {/* LEFT */}
        <section className="flex min-w-[320px] flex-col glass" style={{ width: `${leftWidthPct}%` }}>
          <div className="flex items-center justify-between border-b glass px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">ittri Studio</span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {isSaving ? (<><Save className="h-3 w-3 animate-pulse" /><span>Saving...</span></>) :
                 lastSaved ? (<><Save className="h-3 w-3 text-green-500" /><span>Saved {new Date(lastSaved).toLocaleTimeString()}</span></>) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={openSetup} title="Setup page"><Settings className="mr-1 h-4 w-4" />Setup</Button>
              <Button size="sm" variant={isGenerating ? "default" : "secondary"} onClick={() => setIsPromptDialogOpen(true)} disabled={isGenerating} title="Generate with AI"><Sparkles className="mr-1 h-4 w-4" />{isGenerating ? "Generating…" : "Generate"}</Button>
              {isGenerating && <Button size="sm" variant="outline" onClick={cancelGenerate}>Cancel</Button>}
              <Separator orientation="vertical" className="mx-1 h-6" />
              <Button size="sm" variant="outline" onClick={downloadFile}><Download className="mr-1 h-4 w-4" /> Download</Button>
              <Button size="sm" variant="outline" onClick={uploadFile}><Upload className="mr-1 h-4 w-4" /> Upload</Button>
              <Button size="sm" variant="outline" onClick={resetFile}><RotateCcw className="mr-1 h-4 w-4" /> Reset</Button>
              {!chatEnabled && <Button size="sm" variant="outline" onClick={addChatTab}><MessageSquarePlus className="mr-1 h-4 w-4" /> Chat</Button>}
              <Button size="sm" variant="outline" onClick={() => setIsAddFileDialogOpen(true)}>＋ New File</Button>
            </div>
          </div>

          <Tabs
            value={active.kind === "file" ? files[active.index]?.name : chatEnabled ? "__chat__" : files[0].name}
            onValueChange={(value) => {
              if (value === "__chat__") { setActive({ kind: "chat" }); return; }
              const idx = files.findIndex((f) => f.name === value);
              if (idx !== -1) setActive({ kind: "file", index: idx });
              requestAnimationFrame(updateLineNumbers);
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex items-center border-b glass">
              <ScrollArea className="flex-1">
                <TabsList className="h-auto gap-1 border-0 bg-transparent p-2">
                  {files.map((file, i) => (
                    <TabsTrigger key={file.name + i} value={file.name} className="group relative">
                      <span>📄 {file.name}</span>
                      {files.length > 1 && (
                        <button
                          aria-label={`Close ${file.name}`}
                          onClick={(e) => { e.stopPropagation(); closeFile(i); }}
                          className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded opacity-60 hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </TabsTrigger>
                  ))}
                  {chatEnabled && (
                    <TabsTrigger value="__chat__" className="group relative">
                      <span>💬 Chat History</span>
                      <button
                        aria-label="Close Chat"
                        onClick={(e) => { e.stopPropagation(); removeChatTab(); }}
                        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded opacity-60 hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </TabsTrigger>
                  )}
                </TabsList>
              </ScrollArea>
            </div>

            {files.map((file, i) => (
              <TabsContent key={file.name + i} value={file.name} className="m-0 flex-1 data-[state=inactive]:hidden">
                <div className="relative flex h-full min-h-0 flex-col">
                  <div className="flex items-center justify-between border-b glass px-4 py-1 text-xs text-muted-foreground">
                    <span>{lineCount} lines</span>
                    <span>{file.content.length} characters</span>
                  </div>
                  <ScrollArea className="h-full">
                    <div className="relative min-h[60vh] glass">
                      <div ref={linesRef} className="pointer-events-none absolute left-0 top-4 select-none whitespace-pre px-3 font-mono text-[0.875rem] leading-[1.6] text-[rgba(var(--muted-foreground-rgb),0.55)]" aria-hidden="true" />
                      <Textarea
                        ref={editorRef as any}
                        spellCheck={false}
                        aria-label="Code editor"
                        value={file.content}
                        onChange={(e) => { setFileContent(i, e.target.value); updateLineNumbers(); }}
                        className="custom-scrollbar min-h-[calc(100vh-14rem)] w-full resize-none border-0 bg-transparent px-4 pb-6 pl-14 pt-4 font-mono text-[0.875rem] leading-[1.6] text-foreground outline-none"
                      />
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>
            ))}

            {chatEnabled && (
              <TabsContent value="__chat__" className="m-0 flex-1 data-[state=inactive]:hidden">
                <div className="flex h-full min-h-0 flex-col">
                  <ScrollArea className="flex-1">
                    <ul className="space-y-3 p-4">
                      {chat.length === 0 && <li className="text-sm text-[rgba(var(--muted-foreground-rgb),1)]">No messages yet.</li>}
                      {chat.map((c) => (
                        <li key={c.id} className="glass rounded-xl p-3">
                          <div className="mb-1 text-xs text-[rgba(var(--muted-foreground-rgb),1)]">
                            {c.role === "user" ? "You" : "ittri"} • {new Date(c.at).toLocaleString()}
                          </div>
                          <div className="whitespace-pre-wrap text-sm">{c.text}</div>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                  <div className="glass border-t p-3">
                    <Textarea
                      placeholder={currentFile ? `Note about ${currentFile.name}…` : "Write a note…"}
                      onKeyDown={(e) => {
                        const el = e.currentTarget;
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendChat(el.value);
                          el.value = "";
                        }
                      }}
                      className="focus-neon h-24 w-full resize-none rounded-xl text-sm"
                    />
                  </div>
                </div>
              </TabsContent>
            )}
          </Tabs>
        </section>

        {/* Divider */}
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={() => (draggingRef.current = true)}
          className="group flex w-1 select-none items-center justify-center bg-transparent hover:bg-[rgba(var(--foreground-rgb),.06)]"
          title="Drag to resize"
        >
          <div className="h-10 w-[2px] bg-[rgba(var(--border-rgb),1)] group-hover:bg-[rgba(var(--ring-rgb),.5)]" />
        </div>

        {/* RIGHT: Preview */}
        <section className="flex min-w-[280px] flex-1 flex-col">
          <div className="glass border-b px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">Live Preview</span>
                <Badge
                  variant={status.kind === "active" ? "secondary" : status.kind === "pending" ? "default" : "destructive"}
                  className="status-badge"
                >
                  {status.text}
                  <span className="sr-only" aria-live="polite">Status: {status.text}</span>
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={refreshPreview}><RefreshCw className="mr-1 h-4 w-4" /> Refresh</Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const w = window.open("", "_blank");
                    if (!w) return;
                    w.document.write(srcDoc || "<h1>No content</h1>");
                    w.document.close();
                  }}
                >
                  <ExternalLink className="mr-1 h-4 w-4" /> Open
                </Button>
              </div>
            </div>
          </div>
          <div className="relative flex-1" style={{ background: "transparent" }} aria-busy={isGenerating || isSaving}>
            <iframe key={previewKey} title="Live Preview" sandbox="allow-scripts allow-same-origin" className="h-full w-full border-0" srcDoc={srcDoc} />
          </div>
        </section>

        {/* Add File Dialog */}
        <Dialog open={isAddFileDialogOpen} onOpenChange={setIsAddFileDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New File</DialogTitle>
              <DialogDescription>Enter a filename with extension (e.g., style.css, script.js)</DialogDescription>
            </DialogHeader>
            <Input
              placeholder="new-file.html"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addNewFile(newFileName);
                  setIsAddFileDialogOpen(false);
                  setNewFileName("");
                }
              }}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddFileDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => { addNewFile(newFileName); setIsAddFileDialogOpen(false); setNewFileName(""); }}>Create File</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Generate Prompt Dialog */}
        <Dialog open={isPromptDialogOpen} onOpenChange={setIsPromptDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate with AI</DialogTitle>
              <DialogDescription>Describe what you want the generator to do. Your current file content will be sent as context.</DialogDescription>
            </DialogHeader>
            <Textarea value={genPrompt} onChange={(e) => setGenPrompt(e.target.value)} className="min-h-[120px] text-sm" placeholder="e.g., Convert this HTML into a responsive landing with a sticky CTA." />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPromptDialogOpen(false)}>Close</Button>
              <Button disabled={isGenerating} onClick={async () => { setIsPromptDialogOpen(false); await startGenerate(); }}>
                <Sparkles className="mr-1 h-4 w-4" /> {isGenerating ? "Generating…" : "Generate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Setup Page Dialog */}
        <Dialog open={isSetupOpen} onOpenChange={setIsSetupOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Setup Page</DialogTitle>
              <DialogDescription>Define the file, format, title, and an optional starter template.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="grid grid-cols-3 items-center gap-3">
                <label className="text-sm text-muted-foreground">File name</label>
                <div className="col-span-2">
                  <Input value={setupFileName} onChange={(e) => setSetupFileName(e.target.value)} placeholder={setupFormat === "react" ? "App.tsx" : "index.html"} />
                </div>
              </div>

              <div className="grid grid-cols-3 items-center gap-3">
                <label className="text-sm text-muted-foreground">Format</label>
                <div className="col-span-2">
                  <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={setupFormat} onChange={(e) => setSetupFormat(e.target.value as "html" | "react")}>
                    <option value="html">HTML</option>
                    <option value="react">React (TSX)</option>
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">Live preview renders HTML. React files are shown as text but still work for generation & download.</p>
                </div>
              </div>

              <div className="grid grid-cols-3 items-center gap-3">
                <label className="text-sm text-muted-foreground">Page title</label>
                <div className="col-span-2"><Input value={setupTitle} onChange={(e) => setSetupTitle(e.target.value)} /></div>
              </div>

              <div className="grid grid-cols-3 items-center gap-3">
                <label className="text-sm text-muted-foreground">Starter</label>
                <div className="col-span-2">
                  <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={setupTemplate} onChange={(e) => setSetupTemplate(e.target.value as any)}>
                    <option value="blank">Blank</option>
                    <option value="landing-simple">Landing • Simple</option>
                    <option value="landing-portfolio">Landing • Portfolio</option>
                    <option value="landing-blog">Landing • Blog</option>
                    <option value="landing-launch">Landing • Launch</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={replaceContent} onChange={(e) => setReplaceContent(e.target.checked)} />
                Replace current code with starter
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsSetupOpen(false)}>Cancel</Button>
              <Button onClick={() => {
                setSetupFileName((name) => ensureExtensionForFormat(sanitizeFileName(name || "index"), setupFormat));
                setFormatOverride(setupFormat);
                applySetup();
              }}>
                Save Setup
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
