import { NextResponse } from "next/server";
import { ask, type AskBody } from "@/lib/answer";
import { network } from "@/lib/network";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(body: AskBody) {
  try {
    return NextResponse.json(await ask(network, body));
  } catch (e) {
    console.error("[api/ask]", e);
    return NextResponse.json(
      { answer: { kind: "error", headline: "Une erreur interne est survenue.", detail: "Réessayez dans un instant." } },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: AskBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ answer: { kind: "error", headline: "Requête invalide (JSON attendu)." } }, { status: 400 });
  }
  return handle(body ?? {});
}

/** Pratique pour tester : /api/ask?q=prochain 362 à Grésille */
export async function GET(req: Request) {
  return handle({ question: new URL(req.url).searchParams.get("q") ?? "" });
}
