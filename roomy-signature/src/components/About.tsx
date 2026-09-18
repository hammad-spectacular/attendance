"use client";

import Reveal from "./Reveal";

export default function About() {
  return (
    <section id="about" className="relative overflow-hidden bg-sand text-ink-700 py-32 lg:py-44">
      <div className="absolute inset-0 stripes opacity-60" />
      <div className="container-luxe relative grid grid-cols-1 gap-16 lg:grid-cols-12 lg:gap-20">
        <Reveal className="relative lg:col-span-7">
          <div className="relative aspect-[4/5] overflow-hidden rounded-sm">
            <div
              className="absolute inset-0 bg-cover bg-center transition-transform duration-[2000ms] hover:scale-105"
              style={{
                backgroundImage:
                  "url('https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1600&q=80')",
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900/50 to-transparent" />
          </div>
          {/* Floating accent card */}
          <div className="absolute -bottom-10 -right-6 hidden md:block">
            <div className="rounded-sm border border-ink-700/10 bg-white/90 p-6 shadow-luxe backdrop-blur">
              <div className="text-[10px] uppercase tracking-widest2 text-gold-700">Since</div>
              <div className="font-display text-4xl text-ink-700">2018</div>
              <div className="mt-2 text-xs font-light text-ink-700/60">
                A new standard of hospitality
              </div>
            </div>
          </div>
        </Reveal>

        <div className="lg:col-span-5 lg:pt-10">
          <Reveal>
            <span className="eyebrow text-gold-700">· 01 &nbsp; The Hotel</span>
            <h2 className="mt-4 font-display text-5xl leading-[1.05] text-ink-700 md:text-6xl">
              Welcome to <br />
              <em className="italic text-gold-700">Roomy Signature</em>
            </h2>
          </Reveal>

          <Reveal delay={0.15} className="mt-8 space-y-5 text-base font-light leading-relaxed text-ink-700/80">
            <p>
              Nestled in the prestigious F-6 Markaz, Roomy Signature offers luxury rooms,
              exceptional dining, modern facilities, and unforgettable hospitality.
            </p>
            <p>
              Whether you're visiting for business or leisure, our hotel provides
              the perfect stay — quiet, considered, and deeply personal.
            </p>
            <p>
              Every corner is composed to feel like a private residence —
              polished marble, hand-finished wood, and views that breathe.
            </p>
          </Reveal>

          <Reveal delay={0.3} className="mt-10 flex flex-wrap items-center gap-6">
            <a href="#rooms" className="btn-gold">Learn More</a>
            <a
              href="#contact"
              className="group inline-flex items-center gap-3 text-sm uppercase tracking-widest2 text-ink-700 hover:text-gold-700"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-ink-700/30 transition-all duration-500 group-hover:border-gold-700 group-hover:bg-gold-700 group-hover:text-sand">
                →
              </span>
              Get in touch
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
