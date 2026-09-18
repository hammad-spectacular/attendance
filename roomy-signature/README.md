# Roomy Signature — Luxury Hotel Site

A premium, Awwwards-style landing page for Roomy Signature Hotel (F-6 Markaz, Islamabad).
Built with Next.js 14 App Router, TypeScript, Tailwind CSS, GSAP + ScrollTrigger, and Lenis smooth scroll.

## Tech stack

- **Framework:** Next.js 14 (App Router) + TypeScript
- **Styling:** Tailwind CSS (custom navy / gold / sand theme)
- **Animations:** GSAP + ScrollTrigger
- **Smooth scroll:** Lenis (wired into GSAP ticker + ScrollTrigger)
- **Fonts:** Playfair Display (display) + Poppins (body) via `next/font/google`
- **Hero asset:** `public/hero-loop.mp4` — silent, autoplay, looping, full-screen

## Run

```bash
cd "roomy-signature"
npm install
npm run dev      # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

## Project structure

```
src/
├── app/
│   ├── layout.tsx      # Fonts, metadata, SmoothScroll wrapper
│   ├── page.tsx        # Composes all 15 sections
│   └── globals.css     # Tailwind + theme utilities
└── components/
    ├── SmoothScroll.tsx   # Lenis + GSAP ticker bridge
    ├── Reveal.tsx         # Generic GSAP ScrollTrigger reveal
    ├── Navbar.tsx         # Transparent → solid on scroll + mobile sheet
    ├── Hero.tsx           # Full-screen video, GSAP headline choreography
    ├── Highlights.tsx     # 4 glassmorphism cards
    ├── About.tsx          # Image + copy + Learn More
    ├── Rooms.tsx          # 3 luxury room cards with hover effects
    ├── Amenities.tsx      # 12-cell icon grid
    ├── Dining.tsx         # "Taste the finest cuisine"
    ├── NearbyAttractions.tsx  # Interactive hover-reveal list
    ├── Gallery.tsx        # Masonry grid + category filter + lightbox
    ├── Reviews.tsx        # Auto-rotating testimonial carousel
    ├── WhyChoose.tsx      # 3 cards
    ├── Statistics.tsx     # Animated counters (GSAP)
    ├── Booking.tsx        # Reservation form
    ├── MapContact.tsx     # OpenStreetMap embed + contact list
    ├── Footer.tsx         # Newsletter + 4-col footer + back-to-top
    └── FloatingBookButton.tsx
```

## Design notes

- **Palette:** navy `#0F172A` / `#1E293B`, gold `#C9A227`, sand `#F2ECE4`.
- **Type:** Playfair Display for headlines, Poppins for body. Italic gold spans used as accents.
- **Motion:** scroll reveals via `Reveal` wrapper, hero choreography via GSAP timeline, video parallax on scroll.
- **Smooth scroll:** Lenis duration 1.25s with custom easing; `gsap.ticker.add(lenis.raf)` to keep them in sync.
- **Performance:** lean First Load JS (~143 kB), static prerender of `/`, no client-only routes.

## Customizing

- **Hero video:** replace `public/hero-loop.mp4`. Keep file name or update `Hero.tsx`.
- **Room photos / gallery:** URLs inlined in each component; swap for your CDN.
- **Form submission:** wire `Booking.tsx` to your reservation endpoint.
- **Map:** OpenStreetMap embed in `MapContact.tsx` — swap to Google Maps if you have an API key.
