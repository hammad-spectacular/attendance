"use client";

import Reveal from "./Reveal";

const reasons = [
  {
    title: "Luxury Rooms",
    body: "Hand-finished suites with Italian linens, Hypnos mattresses, and marble bathrooms.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="h-7 w-7">
        <path d="M3 18v-6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v6" />
        <path d="M3 18h18M3 21h18M6 12V9h12v3" />
      </svg>
    ),
  },
  {
    title: "Modern Design",
    body: "Spaces composed by award-winning architects, with locally sourced materials and craft.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="h-7 w-7">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M9 21V9" />
      </svg>
    ),
  },
  {
    title: "Exceptional Hospitality",
    body: "A team that remembers your name, your tea, and the way you like the curtains drawn.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="h-7 w-7">
        <path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.5-7 11-7 11Z" />
      </svg>
    ),
  },
];

export default function WhyChoose() {
  return (
    <section className="relative bg-sand py-32 text-ink-700 lg:py-44">
      <div className="container-luxe">
        <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-12">
          <Reveal className="lg:col-span-7">
            <span className="eyebrow text-gold-700">· 08 &nbsp; Why Roomy</span>
            <h2 className="mt-4 h-section text-ink-700 max-w-xl">
              Three reasons to <em className="italic text-gold-700">return</em>.
            </h2>
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {reasons.map((r, i) => (
            <Reveal
              key={r.title}
              delay={i * 0.1}
              className="group relative overflow-hidden rounded-2xl border border-ink-700/10 bg-white/60 p-8 transition-all duration-500 hover:-translate-y-1 hover:shadow-luxe"
            >
              <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gold/10 blur-2xl transition-all duration-700 group-hover:bg-gold/30" />
              <div className="relative flex items-start justify-between">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 text-gold-700 transition-transform duration-500 group-hover:rotate-12">
                  {r.icon}
                </div>
                <span className="font-display text-5xl text-ink-700/10">
                  0{i + 1}
                </span>
              </div>
              <h3 className="relative mt-8 font-display text-3xl text-ink-700">{r.title}</h3>
              <p className="relative mt-3 text-sm font-light leading-relaxed text-ink-700/70">
                {r.body}
              </p>
              <div className="relative mt-6 inline-flex items-center gap-2 text-[11px] uppercase tracking-widest2 text-gold-700">
                <span className="h-px w-8 bg-gold-700" /> Learn more
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
