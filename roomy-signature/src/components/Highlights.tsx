"use client";

import Reveal from "./Reveal";

const items = [
  {
    icon: "star",
    title: "4.5 Rating",
    sub: "4,487+ Google Reviews",
    detail: "Consistently rated among the finest stays in the capital.",
  },
  {
    icon: "pin",
    title: "Prime Location",
    sub: "F-6 Markaz, Islamabad",
    detail: "Steps from embassies, boutiques, and the city's best dining.",
  },
  {
    icon: "utensils",
    title: "Complimentary Breakfast",
    sub: "Daily 7 – 11 AM",
    detail: "Continental and Pakistani classics, served on the terrace.",
  },
  {
    icon: "pool",
    title: "Rooftop Pool",
    sub: "Open 6 AM – 10 PM",
    detail: "Heated infinity pool overlooking the Margalla hills.",
  },
];

function Icon({ name }: { name: string }) {
  const common = "h-6 w-6";
  switch (name) {
    case "star":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="m12 2 3 7 7 .6-5.4 4.7L18 22l-6-3.7L6 22l1.4-7.7L2 9.6 9 9z" />
        </svg>
      );
    case "pin":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case "utensils":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M6 2v8a2 2 0 0 0 4 0V2M8 10v12M16 2c-2 0-3 2-3 5v5h3v10" />
        </svg>
      );
    case "pool":
      return (
        <svg className={common} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M2 18c2 0 2 1 4 1s2-1 4-1 2 1 4 1 2-1 4-1 2 1 4 1" />
          <path d="M2 22c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 2-1 4-1" />
          <path d="M7 14V4a2 2 0 0 1 4 0v6M15 6v8" />
        </svg>
      );
    default:
      return null;
  }
}

export default function Highlights() {
  return (
    <section
      id="highlights"
      className="relative -mt-24 z-20 container-luxe"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((it, i) => (
          <Reveal
            key={it.title}
            delay={i * 0.08}
            className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-ink-700/80 to-ink-800/90 p-7 backdrop-blur-xl shadow-luxe"
          >
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/10 blur-3xl transition-all duration-700 group-hover:bg-gold/30" />
            <div className="relative flex items-start justify-between">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 text-gold transition-transform duration-500 group-hover:rotate-12">
                <Icon name={it.icon} />
              </div>
              <span className="text-[10px] uppercase tracking-widest2 text-sand/40">
                0{i + 1}
              </span>
            </div>
            <h3 className="mt-6 font-display text-2xl text-sand">{it.title}</h3>
            <div className="mt-1 text-sm text-gold-300">{it.sub}</div>
            <p className="mt-4 text-sm font-light leading-relaxed text-sand/60">
              {it.detail}
            </p>
            <div className="mt-6 h-px w-full bg-gradient-to-r from-gold/40 via-gold/10 to-transparent" />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
