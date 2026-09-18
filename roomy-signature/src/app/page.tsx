import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Highlights from "@/components/Highlights";
import About from "@/components/About";
import Rooms from "@/components/Rooms";
import Amenities from "@/components/Amenities";
import Dining from "@/components/Dining";
import NearbyAttractions from "@/components/NearbyAttractions";
import Gallery from "@/components/Gallery";
import Reviews from "@/components/Reviews";
import WhyChoose from "@/components/WhyChoose";
import Statistics from "@/components/Statistics";
import Booking from "@/components/Booking";
import MapContact from "@/components/MapContact";
import Footer from "@/components/Footer";
import FloatingBookButton from "@/components/FloatingBookButton";

export default function Home() {
  return (
    <main className="relative">
      <Navbar />
      <Hero />
      <Highlights />
      <About />
      <Rooms />
      <Amenities />
      <Dining />
      <NearbyAttractions />
      <Gallery />
      <Reviews />
      <WhyChoose />
      <Statistics />
      <Booking />
      <MapContact />
      <Footer />
      <FloatingBookButton />
    </main>
  );
}
