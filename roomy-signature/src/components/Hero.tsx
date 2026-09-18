"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

const headline = ["Luxury", "Stay", "in", "the", "Heart", "of", "Islamabad."];

export default function Hero() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wordsRef = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      // Pre-headline
      tl.fromTo(
        ".hero-eyebrow",
        { autoAlpha: 0, y: 14 },
        { autoAlpha: 1, y: 0, duration: 0.9 }
      )
        .fromTo(
          ".hero-line",
          { scaleX: 0 },
          { scaleX: 1, duration: 0.8, transformOrigin: "left center" },
          "-=0.4"
        )
        // Words reveal 1s after page load
        .fromTo(
          wordsRef.current.filter(Boolean),
          { autoAlpha: 0, y: 50, rotateX: -30 },
          {
            autoAlpha: 1,
            y: 0,
            rotateX: 0,
            duration: 1.1,
            stagger: 0.08,
            delay: 0.4, // 1s mark counted with the 0.2s eyebrow offset baked in above
          },
          "+=0.2"
        )
        .fromTo(
          ".hero-sub",
          { autoAlpha: 0, y: 24 },
          { autoAlpha: 1, y: 0, duration: 0.9 },
          "-=0.5"
        )
        .fromTo(
          ".hero-cta",
          { autoAlpha: 0, y: 20 },
          { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.1 },
          "-=0.5"
        )
        .fromTo(
          ".hero-meta",
          { autoAlpha: 0, y: 12 },
          { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.08 },
          "-=0.4"
        );

      // Subtle parallax on video as user scrolls
      gsap.to(".hero-video-wrap", {
        yPercent: 18,
        scale: 1.08,
        ease: "none",
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={containerRef}
      id="home"
      className="relative h-screen min-h-[700px] w-full overflow-hidden bg-ink-900 text-sand"
    >
      {/* Video */}
      <div className="hero-video-wrap absolute inset-0">
        <video
          src="/hero-loop.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="h-full w-full object-cover"
        />
        {/* Dark luxury overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink-900/70 via-ink-900/55 to-ink-900/95" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(15,23,42,0.65)_80%)]" />
      </div>

      {/* Top eyebrow + scroll cue */}
      <div className="absolute inset-x-0 top-28 z-10 container-luxe">
        <div className="flex items-center gap-4">
          <span className="hero-eyebrow eyebrow opacity-0">★ ★ ★ ★ ★ &nbsp;·&nbsp; Signature Collection</span>
          <span className="hero-line h-px flex-1 bg-gradient-to-r from-gold/60 to-transparent" />
        </div>
      </div>

      {/* Center content */}
      <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-[clamp(3rem,9vw,8rem)] font-light leading-[0.95] tracking-tight">
          {headline.map((w, i) => (
            <span
              key={i}
              ref={(el) => {
                wordsRef.current[i] = el;
              }}
              className="mx-2 inline-block opacity-0 will-change-transform"
              style={{ perspective: "600px" }}
            >
              {w === "Islamabad." ? <span className="italic gold-text">{w}</span> : w}
            </span>
          ))}
        </h1>

        <p className="hero-sub mt-8 max-w-xl text-base font-light leading-relaxed text-sand/75 md:text-lg opacity-0">
          Experience premium comfort, fine dining, and world-class hospitality —
          an address where Islamabad slows down.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a href="#booking" className="hero-cta btn-gold opacity-0">
            Book Your Stay
          </a>
          <a href="#rooms" className="hero-cta btn-ghost opacity-0">
            Explore Rooms
          </a>
        </div>
      </div>

      {/* Bottom meta strip */}
      <div className="absolute inset-x-0 bottom-0 z-10">
        <div className="container-luxe flex flex-wrap items-end justify-between gap-6 pb-8">
          <div className="hero-meta flex items-center gap-6 opacity-0">
            <div>
              <div className="text-[10px] uppercase tracking-widest2 text-gold-300">Location</div>
              <div className="font-display text-lg text-sand">F-6 Markaz, Islamabad</div>
            </div>
            <div className="hidden h-10 w-px bg-white/15 sm:block" />
            <div className="hidden sm:block">
              <div className="text-[10px] uppercase tracking-widest2 text-gold-300">Reservations</div>
              <div className="font-display text-lg text-sand">+92 51 111 7666</div>
            </div>
          </div>

          <a
            href="#highlights"
            className="hero-meta group flex items-center gap-3 text-[10px] uppercase tracking-widest2 text-sand/70 opacity-0"
          >
            <span>Scroll</span>
            <span className="relative inline-flex h-10 w-6 items-start justify-center rounded-full border border-white/30">
              <span className="mt-2 h-2 w-px bg-gold animate-[float_1.8s_ease-in-out_infinite]" />
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
