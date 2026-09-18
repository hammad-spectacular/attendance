"use client";

import Reveal from "./Reveal";

const rooms = [
  {
    name: "Deluxe Room",
    price: "PKR 29,300",
    img: "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1200&q=80",
    features: ["King Bed", "Mountain View", "Free WiFi", "Breakfast Included"],
  },
  {
    name: "Executive Room",
    price: "PKR 32,400",
    img: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=1200&q=80",
    features: ["Premium Interior", "Workspace", "Mini Bar", "Lounge Access"],
    featured: true,
  },
  {
    name: "Family Suite",
    price: "PKR 58,000",
    img: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
    features: ["2 Bedrooms", "Living Area", "Luxury Bathroom", "Private Balcony"],
  },
];

export default function Rooms() {
  return (
    <section id="rooms" className="relative bg-ink-800 py-32 lg:py-44 text-sand">
      <div className="container-luxe">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <Reveal>
            <span className="eyebrow">· 02 &nbsp; Accommodations</span>
            <h2 className="mt-4 h-section max-w-xl text-sand">
              Rooms composed for <em className="italic gold-text">rest</em> and quiet luxury.
            </h2>
          </Reveal>
          <Reveal delay={0.2} className="max-w-md text-sm font-light leading-relaxed text-sand/60">
            Three signature categories, each finished by hand. Linens woven in Italy,
            mattresses by Hypnos, marble from the mountains of Baluchistan.
          </Reveal>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
          {rooms.map((r, i) => (
            <Reveal
              key={r.name}
              delay={i * 0.12}
              className={`group relative overflow-hidden rounded-2xl border ${
                r.featured ? "border-gold/60 lg:scale-[1.03]" : "border-white/10"
              } bg-ink-700/60 backdrop-blur transition-all duration-700 hover:-translate-y-2 hover:border-gold/80`}
            >
              {/* Image */}
              <div className="relative aspect-[4/5] overflow-hidden">
                <div
                  className="absolute inset-0 bg-cover bg-center transition-transform duration-[1800ms] group-hover:scale-110"
                  style={{ backgroundImage: `url('${r.img}')` }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/30 to-transparent" />

                {r.featured && (
                  <div className="absolute left-4 top-4 rounded-full bg-gold px-3 py-1 text-[10px] font-medium uppercase tracking-widest2 text-ink-700">
                    Most Loved
                  </div>
                )}

                <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest2 text-gold-300">From</div>
                    <div className="font-display text-2xl text-sand">{r.price}</div>
                    <div className="text-[10px] text-sand/50">/ night</div>
                  </div>
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/30 bg-ink-900/40 text-sand transition-all duration-500 group-hover:border-gold group-hover:bg-gold group-hover:text-ink-700">
                    →
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                <h3 className="font-display text-2xl text-sand">{r.name}</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.features.map((f) => (
                    <span
                      key={f}
                      className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-light text-sand/70"
                    >
                      {f}
                    </span>
                  ))}
                </div>
                <button className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full border border-gold/40 py-3 text-[11px] uppercase tracking-widest2 text-gold-300 transition-all duration-500 hover:bg-gold hover:text-ink-700">
                  Book Now
                </button>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
