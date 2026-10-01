import { afterEach, describe, expect, it, vi } from "vitest";
import { parseWithGroq } from "../lib/groq";
import { network } from "./demo";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const reply = (status: number, content?: string) =>
  vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));

describe("appel Groq", () => {
  it("envoie le bon modèle et parse le JSON", async () => {
    const fetchMock = reply(200, JSON.stringify({ intention: "trajet", depart: "Aussonne", arrivee: "Arènes", ligne: null, arret: null, sens: null, heure: null }));
    vi.stubGlobal("fetch", fetchMock);
    const intent = await parseWithGroq("de Aussonne à Arènes", network, "cle");
    expect(intent).toMatchObject({ intention: "trajet", depart: "Aussonne", arrivee: "Arènes" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "llama-3.3-70b-versatile", temperature: 0, response_format: { type: "json_object" } });
  });

  it("clé absente", async () => {
    await expect(parseWithGroq("x", network, "")).rejects.toMatchObject({ reason: "clé IA non configurée" });
  });

  it("limite atteinte (429)", async () => {
    vi.stubGlobal("fetch", reply(429));
    await expect(parseWithGroq("x", network, "cle")).rejects.toMatchObject({ reason: "limite d'utilisation de l'IA atteinte" });
  });

  it("JSON invalide", async () => {
    vi.stubGlobal("fetch", reply(200, "pas du json"));
    await expect(parseWithGroq("x", network, "cle")).rejects.toMatchObject({ reason: "réponse IA illisible" });
  });

  it("timeout à 4 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const p = parseWithGroq("x", network, "cle");
    const check = expect(p).rejects.toMatchObject({ reason: "IA trop lente (> 4 s)" });
    await vi.advanceTimersByTimeAsync(3999);
    await vi.advanceTimersByTimeAsync(1);
    await check;
  });
});
