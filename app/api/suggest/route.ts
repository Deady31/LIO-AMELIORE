import { NextResponse } from "next/server";
import { network } from "@/lib/network";
import { suggestFor } from "@/lib/suggest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** /api/suggest?q=prochain 362 à gresi → { fragment: "gresi", items: [{ name, lines, demo }] } */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120);
  return NextResponse.json(suggestFor(network, q));
}
