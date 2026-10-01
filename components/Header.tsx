// En-tête coloré commun aux écrans + bandeau « concept non officiel ».
export default function Header({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <header className="rounded-b-[28px] bg-gradient-to-br from-brand to-brand-dark px-4 pb-5 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-white">
      <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium tracking-wide">
        <span className="h-1.5 w-1.5 rounded-full bg-white/80" aria-hidden />
        Concept d&apos;assistant IA – non officiel
      </p>
      <h1 className="text-[22px] font-bold leading-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-white/80">{subtitle}</p>}
      {children}
    </header>
  );
}
