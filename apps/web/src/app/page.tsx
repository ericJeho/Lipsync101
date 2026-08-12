import { Nav } from '@/components/layout/Nav';
import { Footer } from '@/components/layout/Footer';
import { Hero } from '@/components/marketing/Hero';
import {
  Engines,
  Features,
  HowItWorks,
  Languages,
  PricingPreview,
  ResponsibleUse,
} from '@/components/marketing/Sections';

export default function HomePage() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Engines />
        <Features />
        <Languages />
        <PricingPreview />
        <ResponsibleUse />
      </main>
      <Footer />
    </>
  );
}
