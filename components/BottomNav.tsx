"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconClock, IconInfo, IconRoute, IconSpark } from "./icons";

const TABS = [
  { href: "/", label: "Assistant", Icon: IconSpark },
  { href: "/lignes", label: "Horaires", Icon: IconClock },
  { href: "/trajet", label: "Itinéraire", Icon: IconRoute },
  { href: "/infos", label: "Infos", Icon: IconInfo },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map(({ href, label, Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${active ? "text-brand" : "text-muted hover:text-ink"}`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? "bg-brand-soft" : ""}`}>
                  <Icon className="h-5 w-5" />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
