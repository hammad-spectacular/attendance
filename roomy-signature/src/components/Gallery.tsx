"use client";

import { useEffect, useState } from "react";
import Reveal from "./Reveal";

const categories = ["All", "Rooms", "Lobby", "Restaurant", "Pool", "Exterior", "Amenities"];

const images: { src: string; cat: string; tall?: boolean }[] = [
  { src: "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1200&q=80", cat: "Rooms" },
  { src: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&w=1200&q=80", cat: "Lobby", tall: true },
  { src: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80", cat: "Restaurant" },
  { src: "https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=1200&q=80", cat: "Pool" },
  { src: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80", cat: "Rooms", tall: true },
  { src: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&w=1200&q=80", cat: "Exterior" },
  { src: "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=80", cat: "Amenities" },
  { src: "https://images.unsplash.com/photo-1631049307264-da0ec9d70304?auto=format&fit=crop&w=1200&q=80", cat: "Rooms" },
  { src: "https://images.unsplash.com/photo-1559599189-fe84dea4eb79?auto=format&fit=crop&w=1200&q=80", cat: "Restaurant", tall: true },
  { src: "https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&w=1200&q=80", cat: "Lobby" },
];

export default function Gallery() {
  const [active, setActive] = useState("All");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const filtered = active === "All" ? images : images.filter((i) => i.cat === active);

  useEffect(() => {
    document.body.style.overflow = lightbox ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [lightbox]);

  return (
    <section id="gallery" className="relative bg-ink-800 py-32 text-sand lg:py-44">
      <div className="container-luxe">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-end">
          <Reveal>
            <span className="eyebrow">· 06 &nbsp; Gallery</span>
            <h2 className="mt-4 h-section text-sand max-w-xl">
              A quiet portfolio of <em className="italic gold-text">moments</em>.
            </h2>
          </Reveal>
        </div>

        {/* Filter pills */}
        <Reveal delay={0.15} className="mt-10 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setActive(c)}
              className={`rounded-full border px-5 py-2 text-[11px] uppercase tracking-widest2 transition-all duration-500 ${
                active === c
                  ? "border-gold bg-gold text-ink-700"
                  : "border-white/15 text-sand/70 hover:border-gold/60 hover:text-gold"
              }`}
            >
              {c}
            </button>
          ))}
        </Reveal>

        {/* Masonry */}
        <div className="mt-12 columns-1 gap-4 sm:columns-2 lg:columns-3">
          {filtered.map((img, i) => (
            <Reveal
              key={img.src + i}
              delay={(i % 5) * 0.06}
              className="mb-4 break-inside-avoid"
            >
              <button
                onClick={() => setLightbox(img.src)}
                className="group relative block w-full overflow-hidden rounded-xl border border-white/10"
              >
                <img
                  src={img.src}
                  alt={img.cat}
                  className={`w-full object-cover transition-transform duration-[1800ms] group-hover:scale-110 ${
                    img.tall ? "aspect-[3/4]" : "aspect-[4/3]"
                  }`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900/80 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between opacity-0 transition-all duration-500 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2">
                  <div className="text-left text-sand">
                    <div className="text-[10px] uppercase tracking-widest2 text-gold-300">
                      {img.cat}
                    </div>
                  </div>
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/30 bg-ink-900/50 text-sand">
                    +
                  </span>
                </div>
              </button>
            </Reveal>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="lightbox-overlay fixed inset-0 z-[100] flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute right-6 top-6 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/30 text-sand"
            aria-label="Close"
          >
            ✕
          </button>
          <img
            src={lightbox}
            alt=""
            className="max-h-[85vh] max-w-[90vw] rounded-sm object-contain shadow-luxe"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </section>
  );
}
