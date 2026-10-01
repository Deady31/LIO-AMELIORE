"use client";

import type { Answer, AskResponse } from "@/lib/answer-types";
import type { StructuredRequest } from "@/lib/intent";
import LineBadge from "./LineBadge";
import { DemoTag, TheoreticalTag } from "./Tags";
import { IconAlert, IconChevron, IconPin, IconRoute } from "./icons";

type Actions = { onRequest: (r: StructuredRequest, label: string) => void; onQuestion: (q: string) => void };

export default function AnswerCard({ res, ...actions }: { res: AskResponse } & Actions) {
  return (
    <article className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,.08)] ring-1 ring-line">
      <Body answer={res.answer} {...actions} />
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5">
        <TheoreticalTag theoretical={res.theoretical} />
        <DemoTag source={res.dataSource} />
        {res.mode === "ia" && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand-dark">Compris par l&apos;IA</span>}
        {res.mode === "repli" && (
          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted" title={res.modeReason}>
            Mode sans IA{res.modeReason ? ` · ${res.modeReason}` : ""}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted">calculé à {res.now}</span>
      </footer>
    </article>
  );
}

function Body({ answer, onRequest, onQuestion }: { answer: Answer } & Actions) {
  switch (answer.kind) {
    case "departures":
      return (
        <div>
          <div className="px-4 pt-4">
            <h2 className="text-[17px] font-semibold leading-snug">{answer.headline}</h2>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted">
              <IconPin className="h-4 w-4 shrink-0" />
              {answer.stopName}
              {answer.fromTime && <span>· {answer.fromTime}</span>}
            </p>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {answer.directions.map((d) => {
              const [first, ...rest] = d.departures;
              return (
                <li key={`${d.line.id}-${d.label}`} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <LineBadge line={d.line} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">vers {d.label}</span>
                    {answer.directions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onRequest(d.request, `${d.line.id} vers ${d.label}`)}
                        className="flex items-center text-xs font-medium text-brand"
                      >
                        Ce sens <IconChevron className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {first ? (
                    <div className="mt-2 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-[28px] font-bold leading-none tabular-nums">
                          {first.day && <span className="mr-1 text-base font-semibold text-muted">{first.day}</span>}
                          {first.time}
                        </p>
                        {first.headsign !== d.label && <p className="mt-1 text-xs text-muted">terminus {first.headsign}</p>}
                      </div>
                      {first.wait && <span className="rounded-lg bg-brand-soft px-2.5 py-1 text-sm font-semibold text-brand-dark">{first.wait}</span>}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted">Pas de passage prévu d&apos;ici demain soir.</p>
                  )}
                  {rest.length > 0 && (
                    <p className="mt-2 text-sm text-muted">
                      Ensuite :{" "}
                      <span className="font-medium tabular-nums text-ink">
                        {rest.map((r) => `${r.day ? `${r.day} ` : ""}${r.time}`).join(" · ")}
                      </span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      );

    case "trips":
      return (
        <div>
          <div className="px-4 pt-4">
            <h2 className="text-[17px] font-semibold leading-snug">{answer.headline}</h2>
            <p className="mt-1 text-sm text-muted">
              {answer.from} → {answer.to}
              {answer.fromTime && <> · {answer.fromTime}</>}
            </p>
            <p className="mt-1 text-xs text-muted">Trajets directs uniquement, sans correspondance.</p>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {answer.trips.map((t, i) => (
              <li key={i} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <LineBadge line={t.line} />
                  <div className="flex flex-1 items-center gap-2 tabular-nums">
                    <span className="text-lg font-bold">
                      {t.day && <span className="mr-1 text-xs font-semibold text-muted">{t.day}</span>}
                      {t.depTime}
                    </span>
                    <span className="h-px flex-1 bg-line" aria-hidden />
                    <span className="text-xs text-muted">{t.duration}</span>
                    <span className="h-px flex-1 bg-line" aria-hidden />
                    <span className="text-lg font-bold">{t.arrTime}</span>
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                  <span className="truncate">
                    {t.fromStop} → {t.toStop} · {t.stopsCount} arrêt{t.stopsCount > 1 ? "s" : ""}
                  </span>
                  {t.wait && <span className="shrink-0 font-semibold text-brand-dark">{t.wait}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      );

    case "no-direct":
      return (
        <div className="flex gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
            <IconRoute className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold">{answer.headline}</h2>
            <p className="mt-1 text-sm text-muted">{answer.detail}</p>
          </div>
        </div>
      );

    case "choice":
      return (
        <div className="p-4">
          <h2 className="font-semibold leading-snug">{answer.headline}</h2>
          <div className="mt-3 flex flex-col gap-2">
            {answer.choices.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onRequest(c.request, c.line ? `${c.line.id} ${c.label}` : c.label)}
                className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition-colors hover:border-brand hover:bg-brand-soft active:scale-[.99]"
              >
                {c.line ? <LineBadge line={c.line} size="sm" /> : <IconPin className="h-4 w-4 shrink-0 text-brand" />}
                <span className="flex-1">
                  <span className="block text-sm font-medium">{c.label}</span>
                  {c.sub && <span className="block text-xs text-muted">{c.sub}</span>}
                </span>
                <IconChevron className="h-4 w-4 text-muted" />
              </button>
            ))}
          </div>
        </div>
      );

    case "error":
      return (
        <div className="flex gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <IconAlert className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{answer.headline}</h2>
            {answer.detail && <p className="mt-1 text-sm text-muted">{answer.detail}</p>}
            {answer.examples && (
              <div className="mt-3 flex flex-wrap gap-2">
                {answer.examples.map((q) => (
                  <button key={q} type="button" onClick={() => onQuestion(q)} className="rounded-full bg-surface px-3 py-1.5 text-xs font-medium hover:bg-brand-soft">
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      );
  }
}
