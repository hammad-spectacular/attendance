"use client";

import { useEffect, useState } from "react";
import Reveal from "./Reveal";

const reviews = [
  {
    name: "Ahmed Khan",
    role: "Business Traveler · Dubai",
    quote:
      "Absolutely amazing experience. The staff was friendly and the rooms were spotless. The rooftop breakfast with Margalla views is a memory I'll keep.",
  },
  {
    name: "Sarah Malik",
    role: "Family Stay · Lahore",
    quote:
      "Best location in Islamabad. Excellent breakfast, spacious family suite, and a concierge who genuinely cares. We extended our stay by two nights.",
  },
  {
    name: "Ali Raza",
    role: "Weekend · Karachi",
    quote:
      "Luxury at an affordable price. The Library bar is the most underrated spot in F-6. Will be back with my partner next month.",
  },
  {
    name: "Mariam Siddiqui",
    role: "Solo · London",
    quote:
      "A discreet, beautifully designed sanctuary. The attention to detail — the linens, the scent in the lobby, the way the doormen greet you — is unmatched.",
  },
];

export default function Reviews() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % reviews.length), 6500);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="relative overflow-hidden bg-ink-900 py-32 text-sand lg:py-44">
      <div className="absolute -left-40 top-20 h-96 w-96 rounded-full bg-gold/5 blur-3xl" />
      <div className="container-luxe relative">
        <div className="grid grid-cols-1 items-center gap-16 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <Reveal>
              <span className="eyebrow">· 07 &nbsp; Reviews</span>
              <h2 className="mt-4 h-section text-sand">
                What our <em className="italic gold-text">guests</em> say.
              </h2>
              <div className="mt-8 flex items-center gap-6">
                <div className="font-display text-6xl text-sand">4.5</div>
                <div>
                  <div className="flex gap-1 text-gold">★★★★★</div>
                  <div className="mt-1 text-xs uppercase tracking-widest2 text-sand/50">
                    4,487 reviews on Google
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

          <div className="relative lg:col-span-7">
            <Reveal>
              <div className="relative aspect-[5/4] overflow-hidden rounded-2xl border border-white/10 bg-ink-700/40 p-8 backdrop-blur-md md:p-12">
                <div className="absolute right-8 top-8 font-display text-9xl leading-none text-gold/15">
                  "
                </div>
                <div key={idx} className="relative flex h-full flex-col justify-between animate-fade-up">
                  <div className="flex gap-1 text-gold text-lg">★★★★★</div>
                  <p className="mt-8 font-display text-2xl leading-snug text-sand md:text-3xl">
                    "{reviews[idx].quote}"
                  </p>
                  <div className="mt-10 flex items-center justify-between">
                    <div>
                      <div className="font-display text-xl text-sand">{reviews[idx].name}</div>
                      <div className="text-xs uppercase tracking-widest2 text-gold-300/80">
                        {reviews[idx].role}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {reviews.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setIdx(i)}
                          className={`h-1.5 rounded-full transition-all duration-500 ${
                            idx === i ? "w-10 bg-gold" : "w-4 bg-white/15"
                          }`}
                          aria-label={`Review ${i + 1}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
