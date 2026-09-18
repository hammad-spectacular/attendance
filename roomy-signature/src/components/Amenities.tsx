"use client";

import Reveal from "./Reveal";

const items = [
  { t: "Free WiFi", d: "Gigabit fiber across all suites" },
  { t: "Swimming Pool", d: "Rooftop, heated infinity" },
  { t: "Free Parking", d: "Valet & secure underground" },
  { t: "Air Conditioning", d: "Climate controlled rooms" },
  { t: "Laundry Service", d: "Same-day turnaround" },
  { t: "24/7 Reception", d: "Concierge at any hour" },
  { t: "Restaurant", d: "On-site fine dining" },
  { t: "Breakfast Included", d: "Continental & Pakistani" },
  { t: "Room Service", d: "Available around the clock" },
  { t: "Airport Pickup", d: "Premium fleet, on request" },
  { t: "Meeting Rooms", d: "Boardroom & banquet halls" },
  { t: "Gym", d: "Fully equipped fitness center" },
];

export default function Amenities() {
  return (
    <section
      id="amenities"
      className="relative overflow-hidden bg-ink-700 py-32 lg:py-44 text-sand"
    >
      <div className="container-luxe">
        <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <span className="eyebrow">· 03 &nbsp; The Essentials</span>
            <h2 className="mt-4 h-section text-sand">
              Everything <em className="italic gold-text">considered</em>, nothing missing.
            </h2>
          </Reveal>
          <Reveal delay={0.15} className="lg:col-span-6 lg:col-start-7">
            <p className="max-w-md text-sm font-light leading-relaxed text-sand/65">
              We obsess over the small print so your stay feels effortless.
              Twelve cornerstones of comfort, delivered with quiet consistency.
            </p>
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/5 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((it, i) => (
            <Reveal
              key={it.t}
              delay={(i % 6) * 0.05}
              className="group relative bg-ink-700 p-7 transition-all duration-500 hover:bg-ink-800"
            >
              <span className="text-[10px] uppercase tracking-widest2 text-gold-300/70">
                0{(i + 1).toString().padStart(2, "0")}
              </span>
              <h3 className="mt-3 font-display text-xl text-sand">{it.t}</h3>
              <p className="mt-1 text-xs font-light text-sand/50">{it.d}</p>
              <div className="mt-5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-gold/30 text-gold-300 transition-all duration-500 group-hover:border-gold group-hover:bg-gold group-hover:text-ink-700">
                ✓
              </div>
              <span className="pointer-events-none absolute -bottom-px -right-px h-0 w-0 border-b-2 border-r-2 border-gold/0 transition-all duration-500 group-hover:h-6 group-hover:w-6 group-hover:border-gold/70" />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
