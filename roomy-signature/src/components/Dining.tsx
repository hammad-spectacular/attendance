"use client";

import Reveal from "./Reveal";

export default function Dining() {
  return (
    <section
      id="dining"
      className="relative overflow-hidden bg-ink-900 py-32 lg:py-44 text-sand"
    >
      <div className="container-luxe grid grid-cols-1 items-center gap-16 lg:grid-cols-12">
        <Reveal className="relative lg:col-span-7">
          <div className="relative aspect-[5/4] overflow-hidden">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage:
                  "url('https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1600&q=80')",
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-tr from-ink-900/60 via-transparent to-transparent" />
          </div>
          {/* Vertical stat */}
          <div className="absolute -left-6 top-12 hidden -rotate-90 items-center gap-3 text-[10px] uppercase tracking-widest2 text-gold-300/80 lg:flex">
            <span className="h-px w-12 bg-gold" /> Skylight by Roomy
          </div>
        </Reveal>

        <div className="lg:col-span-5">
          <Reveal>
            <span className="eyebrow">· 04 &nbsp; Dining</span>
            <h2 className="mt-4 h-section text-sand">
              Taste the <em className="italic gold-text">finest</em> cuisine.
            </h2>
          </Reveal>
          <Reveal delay={0.15} className="mt-6 max-w-md text-base font-light leading-relaxed text-sand/70">
            Enjoy freshly prepared breakfast, international dishes, and premium
            dining experiences throughout your stay — from sunrise pastries
            to candlelit dinner under the atrium.
          </Reveal>
          <Reveal delay={0.3} className="mt-10">
            <a href="#contact" className="btn-gold">Explore Dining</a>
          </Reveal>

          <div className="mt-12 grid grid-cols-2 gap-6 border-t border-white/10 pt-8">
            <Reveal delay={0.4}>
              <div className="text-[10px] uppercase tracking-widest2 text-gold-300">Skylight</div>
              <div className="mt-1 font-display text-2xl text-sand">Rooftop · Turkish & Continental</div>
            </Reveal>
            <Reveal delay={0.5}>
              <div className="text-[10px] uppercase tracking-widest2 text-gold-300">The Library</div>
              <div className="mt-1 font-display text-2xl text-sand">Whiskies · Late Lounge</div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
