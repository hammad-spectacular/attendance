import type { Metadata } from "next";
import { Playfair_Display, Poppins } from "next/font/google";
import SmoothScroll from "@/components/SmoothScroll";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  variable: "--font-playfair",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["200", "300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Roomy Signature Hotel — Luxury Stay in the Heart of Islamabad",
  description:
    "A five-star sanctuary in F-6 Markaz, Islamabad. Refined rooms, signature dining, and an art of hospitality that lingers.",
  keywords: [
    "Roomy Signature",
    "Luxury Hotel Islamabad",
    "F-6 Markaz",
    "Boutique Hotel",
    "5 Star",
  ],
  openGraph: {
    title: "Roomy Signature Hotel",
    description: "Luxury stay in the heart of Islamabad.",
    type: "website",
    locale: "en_US",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${playfair.variable} ${poppins.variable}`}>
      <body className="bg-ink-700 text-sand font-body antialiased">
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
