"use client";

import { useEffect, useState } from "react";

const cols = [
  {
    title: "Hotel",
    links: ["Rooms", "Dining", "Amenities", "Gallery", "About"],
  },
  {
    title: "Reservations",
    links: ["Book a Stay", "Group Bookings", "Weddings & Events", "Gift Vouchers"],
  },
  {
    title: "Discover",
    links: ["Nearby", "Experiences", "Press", "Careers"],
  },
  {
    title: "Legal",
    links: ["Privacy Policy", "Terms of Service", "Cookie Policy", "Sitemap"],
  },
];

export default function Footer() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!submitted) return;
    const t = setTimeout(() => setSubmitted(false), 3000);
    return () => clearTimeout(t);
  }, [submitted]);

  return (
    <footer className="relative overflow-hidden bg-ink-900 pt-24 text-sand">
      <div className="absolute -left-40 top-0 h-80 w-80 rounded-full bg-gold/5 blur-3xl" />
      <div className="container-luxe relative">
        {/* Newsletter */}
        <div className="grid grid-cols-1 items-end gap-10 border-b border-white/10 pb-16 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <span className="eyebrow">Newsletter</span>
            <h3 className="mt-3 font-display text-4xl text-sand md:text-5xl">
              Stay <em className="italic gold-text">close</em> to the house.
            </h3>
            <p className="mt-3 max-w-md text-sm font-light text-sand/60">
              One letter a month — seasonal menus, suites just opened, and the
              occasional invite to something we can't quite announce yet.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (email) {
                setSubmitted(true);
                setEmail("");
              }
            }}
            className="lg:col-span-5"
          >
            <div className="flex items-center border-b border-gold/40 pb-3">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder="your@email.com"
                className="flex-1 bg-transparent text-sand placeholder:text-sand/30 outline-none"
              />
              <button
                type="submit"
                className="text-[11px] uppercase tracking-widest2 text-gold-300 hover:text-gold"
              >
                {submitted ? "✓ Subscribed" : "Subscribe →"}
              </button>
            </div>
          </form>
        </div>

        {/* Main grid */}
        <div className="grid grid-cols-2 gap-10 py-16 md:grid-cols-6">
          <div className="col-span-2">
            <a href="#home" className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gold/60 text-gold">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 21V9l9-6 9 6v12" />
                  <path d="M9 21v-6h6v6" />
                </svg>
              </span>
              <div>
                <div className="font-display text-xl text-sand">Roomy Signature</div>
                <div className="text-[10px] uppercase tracking-widest2 text-gold-300">
                  Hotel · Islamabad
                </div>
              </div>
            </a>
            <p className="mt-6 max-w-xs text-sm font-light leading-relaxed text-sand/60">
              A five-star sanctuary in F-6 Markaz. Crafted for those who travel
              with intention.
            </p>
            <div className="mt-6 flex gap-2">
              {["Instagram", "Facebook", "TikTok"].map((s) => (
                <a
                  key={s}
                  href="#"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-sand/70 transition-all duration-500 hover:border-gold hover:text-gold"
                  aria-label={s}
                >
                  {s[0]}
                </a>
              ))}
            </div>
          </div>

          {cols.map((col) => (
            <div key={col.title}>
              <div className="text-[10px] uppercase tracking-widest2 text-gold-300">
                {col.title}
              </div>
              <ul className="mt-4 space-y-3 text-sm font-light text-sand/70">
                {col.links.map((l) => (
                  <li key={l}>
                    <a href="#" className="transition-colors hover:text-gold">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="flex flex-col items-start justify-between gap-3 border-t border-white/10 py-8 text-xs text-sand/50 md:flex-row md:items-center">
          <div>
            © {new Date().getFullYear()} Roomy Signature Hotel · All rights reserved.
          </div>
          <div className="flex items-center gap-3">
            <span>F-6 Markaz, Islamabad</span>
            <span className="h-1 w-1 rounded-full bg-gold" />
            <span>+92 51 111 7666</span>
          </div>
        </div>
      </div>

      {/* Back to top */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="fixed bottom-6 right-6 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full border border-gold/40 bg-ink-800/80 text-gold-300 backdrop-blur-md transition-all duration-500 hover:bg-gold hover:text-ink-700"
        aria-label="Back to top"
      >
        ↑
      </button>
    </footer>
  );
}
