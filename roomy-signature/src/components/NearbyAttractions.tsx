"use client";

import { useState } from "react";
import Reveal from "./Reveal";

const spots = [
  {
    name: "Faisal Mosque",
    distance: "5 km",
    blurb: "An architectural icon framed against the Margallas.",
    img: "https://images.unsplash.com/photo-1587974928442-77dc3e0dba72?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Pakistan Monument",
    distance: "7 km",
    blurb: "Four petals of marble — a national symbol at sunset.",
    img: "https://images.unsplash.com/photo-1567604130959-7ea7ab2a7eaa?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Centaurus Mall",
    distance: "1.2 km",
    blurb: "Luxury retail, dining, and a Sky Bridge walk.",
    img: "https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Daman-e-Koh",
    distance: "12 km",
    blurb: "A viewpoint that opens the whole capital below you.",
    img: "https://images.unsplash.com/photo-1605649461784-edc01e8c0a13?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Lok Virsa Museum",
    distance: "8 km",
    blurb: "Pakistan's living heritage, indoors and out.",
    img: "https://images.unsplash.com/photo-1587974928442-77dc3e0dba72?auto=format&fit=crop&w=1200&q=80",
  },
  {
    name: "Blue Area",
    distance: "0.4 km",
    blurb: "Walkable high street of embassies, plazas, and cafés.",
    img: "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1200&q=80",
  },
];

export default function NearbyAttractions() {
  const [active, setActive] = useState(0);
  return (
    <section className="relative overflow-hidden bg-sand py-32 text-ink-700 lg:py-44">
      <div className="container-luxe">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <Reveal>
            <span className="eyebrow text-gold-700">· 05 &nbsp; Around the Hotel</span>
            <h2 className="mt-4 h-section text-ink-700 max-w-xl">
              The city at your <em className="italic text-gold-700">doorstep</em>.
            </h2>
          </Reveal>
          <Reveal delay={0.15} className="max-w-sm text-sm font-light text-ink-700/70">
            From heritage to high street, our concierge keeps the best of
            Islamabad within a few minutes' drive.
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-10 lg:grid-cols-12">
          {/* List */}
          <div className="lg:col-span-5">
            <ul className="divide-y divide-ink-700/10 border-y border-ink-700/10">
              {spots.map((s, i) => (
                <li
                  key={s.name}
                  onMouseEnter={() => setActive(i)}
                  className={`group cursor-pointer py-5 transition-colors ${
                    active === i ? "text-ink-700" : "text-ink-700/60"
                  }`}
                >
                  <Reveal delay={i * 0.05}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-5">
                        <span className="font-display text-sm text-gold-700">
                          0{i + 1}
                        </span>
                        <div>
                          <div className="font-display text-2xl leading-none">
                            {s.name}
                          </div>
                          <div className="mt-1 text-xs font-light text-ink-700/60">
                            {s.blurb}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-widest2 text-gold-700">
                          {s.distance}
                        </div>
                        <div className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-ink-700/20 transition-all duration-500 group-hover:border-gold-700 group-hover:bg-gold-700 group-hover:text-sand">
                          →
                        </div>
                      </div>
                    </div>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>

          {/* Preview image */}
          <Reveal className="relative lg:col-span-7">
            <div className="relative aspect-[4/3] overflow-hidden">
              {spots.map((s, i) => (
                <div
                  key={s.name}
                  className={`absolute inset-0 bg-cover bg-center transition-opacity duration-1000 ${
                    active === i ? "opacity-100" : "opacity-0"
                  }`}
                  style={{ backgroundImage: `url('${s.img}')` }}
                />
              ))}
              <div className="absolute inset-0 bg-gradient-to-t from-ink-900/40 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between text-sand">
                <div>
                  <div className="text-[10px] uppercase tracking-widest2 text-gold-300">
                    {spots[active].distance}
                  </div>
                  <div className="font-display text-3xl">{spots[active].name}</div>
                </div>
                <span className="text-xs text-sand/70">Hover to explore</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
