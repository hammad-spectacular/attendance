"use client";

import { useState } from "react";
import Reveal from "./Reveal";

export default function Booking() {
  const [done, setDone] = useState(false);
  return (
    <section id="booking" className="relative overflow-hidden bg-ink-700 py-32 text-sand lg:py-44">
      <div className="absolute inset-0 stripes opacity-40" />
      <div className="container-luxe relative">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <Reveal className="lg:col-span-5">
            <span className="eyebrow">· 09 &nbsp; Reservations</span>
            <h2 className="mt-4 h-section text-sand">
              Begin your <em className="italic gold-text">stay</em>.
            </h2>
            <p className="mt-6 max-w-md text-sm font-light leading-relaxed text-sand/65">
              Direct booking gives you our best rate, complimentary upgrades
              when available, and a small welcome from the house.
            </p>
            <ul className="mt-10 space-y-4 text-sm text-sand/70">
              {[
                "Best rate guarantee",
                "Free cancellation up to 24h",
                "Welcome amenity on arrival",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gold/50 text-[11px] text-gold">
                    ✓
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.15} className="lg:col-span-7">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setDone(true);
                setTimeout(() => setDone(false), 3500);
              }}
              className="grid grid-cols-1 gap-4 rounded-2xl border border-white/10 bg-ink-800/60 p-6 backdrop-blur-md md:grid-cols-2 md:p-10"
            >
              <Field label="Check-in" type="date" />
              <Field label="Check-out" type="date" />
              <Field label="Guests" type="number" placeholder="2" />
              <div className="flex flex-col">
                <label className="text-[10px] uppercase tracking-widest2 text-gold-300">
                  Room Type
                </label>
                <select className="mt-2 rounded-md border border-white/10 bg-ink-900/60 px-4 py-3 text-sand outline-none focus:border-gold">
                  <option>Deluxe Room</option>
                  <option>Executive Room</option>
                  <option>Family Suite</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="btn-gold w-full md:w-auto"
                >
                  {done ? "✓ Request Received" : "Search Availability"}
                </button>
              </div>
            </form>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  type,
  placeholder,
}: {
  label: string;
  type: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col">
      <label className="text-[10px] uppercase tracking-widest2 text-gold-300">
        {label}
      </label>
      <input
        type={type}
        placeholder={placeholder}
        className="mt-2 rounded-md border border-white/10 bg-ink-900/60 px-4 py-3 text-sand placeholder:text-sand/30 outline-none focus:border-gold"
      />
    </div>
  );
}
