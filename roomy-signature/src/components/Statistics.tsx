"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Reveal from "./Reveal";

gsap.registerPlugin(ScrollTrigger);

const stats = [
  { value: 4500, suffix: "+", label: "Happy Guests" },
  { value: 100, suffix: "+", label: "Luxury Rooms" },
  { value: 4.5, suffix: "★", label: "Google Rating", decimals: 1 },
  { value: 24, suffix: "/7", label: "Support" },
];

function Counter({ to, decimals = 0, suffix }: { to: number; decimals?: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obj = { v: 0 };
    const trigger = ScrollTrigger.create({
      trigger: el,
      start: "top 90%",
      once: true,
      onEnter: () => {
        gsap.to(obj, {
          v: to,
          duration: 2.2,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent =
              (decimals ? obj.v.toFixed(decimals) : Math.round(obj.v).toString()) + suffix;
          },
        });
      },
    });
    return () => {
      trigger.kill();
    };
  }, [to, decimals, suffix]);

  return (
    <span ref={ref} className="tabular-nums">
      0{suffix}
    </span>
  );
}

export default function Statistics() {
  const [bg, setBg] = useState(false);
  useEffect(() => {
    const onScroll = () => setBg(window.scrollY > 50);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section className="relative overflow-hidden border-y border-white/10 bg-ink-900 py-24 text-sand">
      <div className="container-luxe grid grid-cols-2 gap-12 md:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.1} className="text-center md:text-left">
            <div className="font-display text-6xl text-sand md:text-7xl">
              <Counter to={s.value} suffix={s.suffix} decimals={s.decimals} />
            </div>
            <div className="mt-2 text-[11px] uppercase tracking-widest2 text-gold-300">
              {s.label}
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
