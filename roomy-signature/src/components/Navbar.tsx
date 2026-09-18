"use client";

import { useEffect, useState } from "react";
import { gsap } from "gsap";

const links = [
  { label: "Home", href: "#home" },
  { label: "Rooms", href: "#rooms" },
  { label: "Dining", href: "#dining" },
  { label: "Amenities", href: "#amenities" },
  { label: "Gallery", href: "#gallery" },
  { label: "About", href: "#about" },
  { label: "Contact", href: "#contact" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Intro fade for the brand mark
  useEffect(() => {
    gsap.fromTo(
      ".nav-anim",
      { autoAlpha: 0, y: -12 },
      { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.06, delay: 0.2, ease: "power3.out" }
    );
  }, []);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          scrolled
            ? "bg-ink-800/80 backdrop-blur-xl border-b border-white/5 py-3"
            : "bg-transparent py-6"
        }`}
      >
        <nav className="container-luxe flex items-center justify-between">
          {/* Brand */}
          <a href="#home" className="nav-anim flex items-center gap-3 group">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gold/60 text-gold transition-transform duration-500 group-hover:rotate-45">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 21V9l9-6 9 6v12" />
                <path d="M9 21v-6h6v6" />
              </svg>
            </span>
            <div className="leading-tight">
              <div className="font-display text-lg tracking-wide text-sand">Roomy Signature</div>
              <div className="text-[10px] uppercase tracking-widest2 text-gold-300">Hotel · Islamabad</div>
            </div>
          </a>

          {/* Desktop */}
          <ul className="hidden lg:flex items-center gap-9">
            {links.map((l) => (
              <li key={l.href} className="nav-anim">
                <a
                  href={l.href}
                  className="group relative text-sm font-light tracking-wide text-sand/80 transition-colors hover:text-gold"
                >
                  {l.label}
                  <span className="absolute -bottom-1 left-0 h-px w-0 bg-gold transition-all duration-500 group-hover:w-full" />
                </a>
              </li>
            ))}
          </ul>

          {/* CTA */}
          <div className="hidden lg:flex nav-anim">
            <a href="#booking" className="btn-gold">
              Book Now
            </a>
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setOpen((s) => !s)}
            className="lg:hidden flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-sand"
            aria-label="Menu"
          >
            <span className="relative block h-3 w-5">
              <span
                className={`absolute left-0 top-0 h-px w-full bg-current transition-all duration-300 ${
                  open ? "translate-y-1.5 rotate-45" : ""
                }`}
              />
              <span
                className={`absolute left-0 top-1.5 h-px w-full bg-current transition-all duration-300 ${
                  open ? "opacity-0" : ""
                }`}
              />
              <span
                className={`absolute left-0 top-3 h-px w-full bg-current transition-all duration-300 ${
                  open ? "-translate-y-1.5 -rotate-45" : ""
                }`}
              />
            </span>
          </button>
        </nav>
      </header>

      {/* Mobile sheet */}
      <div
        className={`fixed inset-0 z-40 lg:hidden transition-all duration-500 ${
          open ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <div
          className={`absolute inset-0 bg-ink-900/80 backdrop-blur-xl transition-opacity duration-500 ${
            open ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setOpen(false)}
        />
        <div
          className={`absolute right-0 top-0 h-full w-[80%] max-w-sm border-l border-white/10 bg-ink-800 p-8 transition-transform duration-500 ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="mt-20 flex flex-col gap-6">
            {links.map((l, i) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="font-display text-3xl text-sand hover:text-gold"
                style={{ transitionDelay: `${i * 50}ms` }}
              >
                {l.label}
              </a>
            ))}
            <a href="#booking" onClick={() => setOpen(false)} className="btn-gold mt-6 self-start">
              Book Now
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
