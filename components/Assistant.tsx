"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AskResponse } from "@/lib/answer-types";
import type { StructuredRequest } from "@/lib/intent";
import AnswerCard from "./AnswerCard";
import { IconSend, IconSpark } from "./icons";

type Entry = { id: number; label: string; state: "loading" } | { id: number; label: string; state: "done"; res: AskResponse } | { id: number; label: string; state: "failed"; message: string };

const CLIENT_TIMEOUT_MS = 12_000;

async function callApi(body: { question: string } | { request: StructuredRequest }): Promise<AskResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json().catch(() => null);
    if (data?.answer && data.now) return data as AskResponse;
    throw new Error(data?.answer?.headline ?? `Le serveur a répondu ${res.status}. Réessayez dans un instant.`);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Le serveur met trop de temps à répondre. Réessayez.");
    if (e instanceof TypeError) throw new Error("Impossible de joindre le serveur. Vérifiez votre connexion.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export default function Assistant({ examples }: { examples: string[] }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const nextId = useRef(1);
  const params = useSearchParams();
  const router = useRouter();
  const started = useRef(false);

  const run = useCallback(async (label: string, body: { question: string } | { request: StructuredRequest }) => {
    const id = nextId.current++;
    setEntries((list) => [{ id, label, state: "loading" }, ...list]);
    let done: Entry;
    try {
      done = { id, label, state: "done", res: await callApi(body) };
    } catch (e) {
      done = { id, label, state: "failed", message: (e as Error).message };
    }
    setEntries((list) => list.map((x) => (x.id === id ? done : x)));
  }, []);

  const askQuestion = useCallback((q: string) => {
    const question = q.trim();
    if (!question) return;
    setInput("");
    run(question, { question });
  }, [run]);

  const askRequest = useCallback((request: StructuredRequest, label: string) => run(label, { request }), [run]);

  // Question transmise par un autre écran : /?q=…
  useEffect(() => {
    const q = params.get("q");
    if (q && !started.current) {
      started.current = true;
      askQuestion(q);
      router.replace("/", { scroll: false });
    }
  }, [params, askQuestion, router]);

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          askQuestion(input);
        }}
        className="relative -mt-7 mx-4 flex items-center gap-2 rounded-2xl bg-white p-1.5 pl-3 shadow-[0_6px_20px_rgba(16,24,40,.12)] ring-1 ring-line"
        role="search"
      >
        <IconSpark className="h-4 w-4 shrink-0 text-brand" />
        <label htmlFor="ask" className="sr-only">
          Votre question
        </label>
        <input
          id="ask"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Demande-moi un horaire ou un trajet"
          maxLength={300}
          autoComplete="off"
          enterKeyHint="send"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none placeholder:text-[14px] placeholder:text-muted"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label="Envoyer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition-opacity disabled:opacity-40"
        >
          <IconSend className="h-5 w-5" />
        </button>
      </form>

      <section className="px-4 pt-4" aria-label="Exemples">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Essayez</h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {examples.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => askQuestion(q)}
              className="shrink-0 rounded-full bg-white px-3.5 py-2 text-sm font-medium shadow-sm ring-1 ring-line transition-colors hover:bg-brand-soft hover:ring-brand/30"
            >
              {q}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4 px-4 pt-5" aria-live="polite" aria-label="Réponses">
        {entries.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-white/60 p-4 text-sm text-muted">
            <p className="font-medium text-ink">Comment ça marche ?</p>
            <p className="mt-1">
              Posez votre question en langage courant : l&apos;IA comprend la demande, puis les horaires sont calculés à partir des fiches horaires du réseau.
            </p>
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id} className="space-y-2">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-sm text-white">{e.label}</p>
            {e.state === "loading" && (
              <div className="animate-pulse rounded-2xl bg-white p-4 ring-1 ring-line">
                <div className="h-4 w-3/4 rounded bg-surface" />
                <div className="mt-3 h-8 w-1/3 rounded bg-surface" />
                <p className="sr-only">Recherche en cours…</p>
              </div>
            )}
            {e.state === "failed" && <div className="rounded-2xl bg-white p-4 text-sm ring-1 ring-amber-200">{e.message}</div>}
            {e.state === "done" && <AnswerCard res={e.res} onRequest={askRequest} onQuestion={askQuestion} />}
          </div>
        ))}
      </section>
    </>
  );
}
