import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const BACKEND_BASE = process.env.NEXT_PUBLIC_API_URL || "http://0.0.0.0:8000";
const PROXY_TIMEOUT_MS = 30000;

function pickAccessToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader;
  
  const cookies = req.cookies;
  const accessToken = cookies.get("access_token")?.value;
  if (accessToken) return `Bearer ${accessToken}`;
  
  return null;
}

function filteredResponseHeaders(upstream: Response): Headers {
  const filtered = new Headers();
  const exclude = new Set([
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "host",
  ]);
  
  upstream.headers.forEach((value, key) => {
    if (!exclude.has(key.toLowerCase())) {
      filtered.set(key, value);
    }
  });
  
  return filtered;
}

async function proxyRequest(
  req: NextRequest,
  method: string,
  path: string[]
): Promise<NextResponse> {
  const pathString = path.join("/");
  const backendUrl = `${BACKEND_BASE}/api/${pathString}`;
  const searchParams = req.nextUrl.searchParams.toString();
  const fullUrl = searchParams ? `${backendUrl}?${searchParams}` : backendUrl;
  
  const bearer = pickAccessToken(req);
  
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort("upstream_timeout"), PROXY_TIMEOUT_MS);
  
  try {
    const headers = new Headers();
    headers.set("accept", "application/json");
    headers.set("content-type", "application/json");
    
    if (bearer) {
      headers.set("authorization", bearer);
    }
    
    const init: RequestInit = {
      method,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: ctrl.signal,
    };
    
    if (method !== "GET" && method !== "HEAD") {
      const body = await req.text();
      if (body) {
        init.body = body;
      }
    }
    
    const upstream = await fetch(fullUrl, init);
    const responseBody = await upstream.arrayBuffer();
    
    const headersOut = filteredResponseHeaders(upstream);
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) {
      headersOut.append("set-cookie", setCookie);
    }
    
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: headersOut,
    });
  } catch (e: any) {
    const name = e?.name || "";
    const msg = String(e?.message || e);
    const status = name === "AbortError" || msg.includes("timeout") ? 504 : 502;
    
    return NextResponse.json(
      { 
        ok: false, 
        error: "upstream_error", 
        detail: msg, 
        backend: BACKEND_BASE, 
        tried: fullUrl 
      },
      { status }
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(req, "GET", params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(req, "POST", params.path);
}

export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(req, "PUT", params.path);
}

export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(req, "PATCH", params.path);
}

export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxyRequest(req, "DELETE", params.path);
}

export function OPTIONS() { 
  return new NextResponse(null, { 
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
  }); 
}

export function HEAD() { 
  return new NextResponse(null, { status: 200 }); 
}
