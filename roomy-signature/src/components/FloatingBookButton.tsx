"use client";

import { useEffect, useState } from "react";

export default function FloatingBookButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <a
      href="#booking"
      className={`fixed bottom-6 left-1/2 z-40 -translate-x-1/2 transition-all duration-700 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-10 opacity-0"
      }`}
    >
      <span className="inline-flex items-center gap-3 rounded-full bg-gold px-6 py-3 text-[11px] font-medium uppercase tracking-widest2 text-ink-700 shadow-gold animate-float">
        Book Your Stay
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink-700 text-gold">
          →
        </span>
      </span>
    </a>
  );
}
