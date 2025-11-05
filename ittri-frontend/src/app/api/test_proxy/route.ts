import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const response = await fetch("https://09c83f29-0f55-4757-8016-aa5d4ffbbaf5-00-1fq75tid6n0c9.spock.replit.dev:8000/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: body.email,
        password: body.password,
        role: body.role || 'seller',
        tier: body.tier || 'starter',
        company_name: body.companyName,
        plan: body.tier || 'starter',
      }),
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ error: "proxy_failed", detail: error.message }, { status: 500 });
  }
}