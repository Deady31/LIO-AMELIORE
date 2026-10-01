"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TheoreticalTag } from "./Tags";
import { IconPin, IconSwap } from "./icons";

export default function TripForm({ stops }: { stops: string[] }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");

  return (
    <form
      className="m-4 space-y-3 rounded-2xl bg-white p-4 shadow-[0_1px_3px_rgba(16,24,40,.08)] ring-1 ring-line"
      onSubmit={(e) => {
        e.preventDefault();
        if (!from.trim() || !to.trim()) return setError("Indiquez un départ et une arrivée.");
        const q = `Comment aller de ${from.trim()} à ${to.trim()}${time ? ` à ${time.replace(":", "h")}` : ""} ?`;
        router.push(`/?q=${encodeURIComponent(q)}`);
      }}
    >
      <datalist id="stops">
        {stops.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="relative space-y-2">
        {[
          { id: "from", label: "Départ", value: from, set: setFrom, dot: "bg-white border-2 border-brand" },
          { id: "to", label: "Arrivée", value: to, set: setTo, dot: "bg-brand" },
        ].map((f) => (
          <label key={f.id} htmlFor={f.id} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5">
            <span className={`h-3 w-3 shrink-0 rounded-full ${f.dot}`} aria-hidden />
            <span className="sr-only">{f.label}</span>
            <input
              id={f.id}
              list="stops"
              value={f.value}
              onChange={(e) => {
                f.set(e.target.value);
                setError("");
              }}
              placeholder={f.label}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            />
          </label>
        ))}
        <button
          type="button"
          aria-label="Inverser départ et arrivée"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white text-brand shadow ring-1 ring-line"
        >
          <IconSwap className="h-5 w-5" />
        </button>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted">Partir à (facultatif)</span>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded-lg bg-surface px-2 py-1.5 tabular-nums outline-none" />
      </label>
      {error && <p className="text-sm text-brand-dark">{error}</p>}
      <button type="submit" className="w-full rounded-xl bg-brand py-3 font-semibold text-white active:scale-[.99]">
        Rechercher
      </button>
      <p className="flex items-center justify-between text-xs text-muted">
        <span className="flex items-center gap-1">
          <IconPin className="h-3.5 w-3.5" /> Sans correspondance
        </span>
        <TheoreticalTag />
      </p>
    </form>
  );
}
