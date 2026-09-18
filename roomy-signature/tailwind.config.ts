import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Roomy Signature brand palette
        ink: {
          DEFAULT: "#0F172A",
          50: "#F8FAFC",
          100: "#EEF2F6",
          200: "#D8DFE7",
          300: "#A6B1C0",
          400: "#5C6A7E",
          500: "#1E293B",
          600: "#172033",
          700: "#0F172A",
          800: "#0B1120",
          900: "#060A14",
        },
        gold: {
          DEFAULT: "#C9A227",
          50: "#FBF6E4",
          100: "#F4E8B7",
          200: "#E9D27E",
          300: "#DDBB4B",
          400: "#D3AE2F",
          500: "#C9A227",
          600: "#A0821A",
          700: "#776114",
          800: "#4F410D",
          900: "#282107",
        },
        sand: {
          DEFAULT: "#F2ECE4",
          50: "#FBF8F4",
          100: "#F6F1EA",
          200: "#EADFCF",
          300: "#DCC8AC",
        },
      },
      fontFamily: {
        display: ["var(--font-playfair)", "Georgia", "serif"],
        body: ["var(--font-poppins)", "system-ui", "sans-serif"],
      },
      letterSpacing: {
        widest2: "0.35em",
      },
      animation: {
        "fade-up": "fadeUp 1s cubic-bezier(0.22, 1, 0.36, 1) forwards",
        "slow-zoom": "slowZoom 20s ease-in-out infinite alternate",
        "shimmer": "shimmer 2.5s linear infinite",
        float: "float 4s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(40px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slowZoom: {
          "0%": { transform: "scale(1)" },
          "100%": { transform: "scale(1.08)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      boxShadow: {
        luxe: "0 30px 80px -20px rgba(15, 23, 42, 0.45)",
        gold: "0 12px 40px -8px rgba(201, 162, 39, 0.45)",
      },
    },
  },
  plugins: [],
};
export default config;
