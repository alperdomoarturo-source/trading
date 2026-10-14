"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Panel" },
  { href: "/explorer", label: "Explorador" },
  { href: "/signals", label: "Señales" },
  { href: "/backtest", label: "Backtest" },
  { href: "/paper", label: "Simulación" },
  { href: "/settings", label: "Config" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-up" aria-hidden />
            Terminal de Señales
          </Link>
          <nav aria-label="Principal" className="flex items-center gap-1 overflow-x-auto">
            {LINKS.map((l) => {
              const active =
                l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                    active
                      ? "bg-surface-2 text-accent"
                      : "text-muted hover:text-foreground hover:bg-surface-2"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
}
