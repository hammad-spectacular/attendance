"use client";

import Reveal from "./Reveal";

export default function MapContact() {
  return (
    <section id="contact" className="relative bg-ink-800 text-sand">
      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* Map */}
        <Reveal className="relative h-[480px] lg:h-[640px] overflow-hidden">
          <img
            src="https://staticmap.openstreetmap.de/staticmap.php?center=33.7104,73.0901&zoom=15&size=800x1200&markers=33.7104,73.0901,ol-marker"
            alt="Map of F-6 Markaz, Islamabad"
            className="absolute inset-0 h-full w-full object-cover grayscale-[30%] contrast-110"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-ink-900/70 to-transparent" />
          <div className="absolute inset-0 flex flex-col justify-end p-8">
            <div className="rounded-xl border border-white/10 bg-ink-900/90 p-6 backdrop-blur-md">
              <div className="text-[10px] uppercase tracking-widest2 text-gold-300">Address</div>
              <div className="mt-1 font-display text-2xl text-sand">Roomy Signature Hotel</div>
              <div className="text-sm text-sand/60">F-6 Markaz, Islamabad, Pakistan</div>
              <a
                href="https://www.google.com/maps/search/?api=1&query=33.7104,73.0901"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-[11px] uppercase tracking-widest2 text-gold-300 hover:text-gold"
              >
                Open in Maps →
              </a>
            </div>
          </div>
        </Reveal>

        {/* Contact */}
        <div className="px-6 py-20 lg:px-16 lg:py-32">
          <Reveal>
            <span className="eyebrow">· 10 &nbsp; Contact</span>
            <h2 className="mt-4 h-section text-sand">
              We're <em className="italic gold-text">here</em> to help.
            </h2>
          </Reveal>

          <div className="mt-10 space-y-8">
            {[
              { l: "Phone", v: "+92 51 111 7666", h: "tel:+92511117666" },
              { l: "Email", v: "reservations@roomysignature.com", h: "mailto:reservations@roomysignature.com" },
              { l: "Address", v: "F-6 Markaz, Islamabad, Pakistan", h: "#" },
              { l: "Hours", v: "Reception & Concierge · 24 / 7", h: "#" },
            ].map((row, i) => (
              <Reveal key={row.l} delay={i * 0.08}>
                <a
                  href={row.h}
                  className="group flex items-center justify-between gap-6 border-b border-white/10 pb-5 transition-colors hover:border-gold"
                >
                  <div>
                    <div className="text-[10px] uppercase tracking-widest2 text-gold-300">
                      {row.l}
                    </div>
                    <div className="mt-1 font-display text-xl text-sand group-hover:text-gold">
                      {row.v}
                    </div>
                  </div>
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-sand/70 transition-all duration-500 group-hover:border-gold group-hover:bg-gold group-hover:text-ink-700">
                    →
                  </span>
                </a>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.4} className="mt-10 flex items-center gap-3">
            {["Instagram", "Facebook", "TikTok"].map((s) => (
              <a
                key={s}
                href="#"
                className="rounded-full border border-white/10 px-4 py-2 text-[11px] uppercase tracking-widest2 text-sand/70 transition-all duration-500 hover:border-gold hover:text-gold"
              >
                {s}
              </a>
            ))}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
