import { useEffect, useState } from "react";

const SLIDES = [
  { src: "/images/interview-1.jpg", alt: "Two candidates shaking hands across the interview table" },
  { src: "/images/interview-2.jpg", alt: "A panel of three interviewers listening to a candidate" },
  { src: "/images/interview-3.jpg", alt: "A hiring panel smiling while reviewing a candidate's resume" },
];

const INTERVAL_MS = 5000;

// Full-bleed crossfading background carousel for the hero. Real photography,
// not an icon or illustration, per the Cowboy style reference's "photo-only" rule.
export default function HeroCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % SLIDES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="hero-carousel" role="img" aria-label={SLIDES[activeIndex].alt}>
      {SLIDES.map((slide, i) => (
        <img
          key={slide.src}
          src={slide.src}
          alt=""
          className="hero-carousel-slide"
          style={{ opacity: i === activeIndex ? 1 : 0 }}
        />
      ))}
    </div>
  );
}
