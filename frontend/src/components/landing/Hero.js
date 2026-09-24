import { useRef } from 'react';
import { motion, useScroll, useTransform, useMotionValue, useSpring } from 'framer-motion';
import MaskedLine from './MaskedLine';

export default function Hero({ loginCard }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const ringsY = useTransform(scrollYProgress, [0, 1], [0, 180]);
  const gridY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const fade = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [10, -10]), { stiffness: 120, damping: 14 });
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-10, 10]), { stiffness: 120, damping: 14 });

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <section ref={ref} className="hero" data-testid="hero-section" onMouseMove={onMove}>
      <motion.div className="hero-grid-bg" style={{ y: gridY }} />
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      <motion.div className="rings" style={{ y: ringsY, opacity: fade }}>
        <div className="ring ring-1" />
        <div className="ring ring-2" />
        <div className="ring ring-3" />
        <div className="ring ring-4" />
      </motion.div>

      <div className="hero-inner">
        <div>
          <motion.div
            className="hero-brand"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div className="medallion" style={{ rotateX, rotateY }}>
              <img src="/phed-logo.png" alt="PHED emblem" />
            </motion.div>
            <div>
              <p className="hero-brand-name">Public Health Engineering Department</p>
              <p className="hero-brand-sub">(PHED) · Govt. Survey Wing</p>
            </div>
          </motion.div>

          <h1 className="hero-title" data-testid="hero-title">
            <MaskedLine delay={0.15}>Every home.</MaskedLine>
            <MaskedLine delay={0.3}>Every drop.</MaskedLine>
            <MaskedLine delay={0.45}><em>Counted.</em></MaskedLine>
          </h1>

          <motion.p
            className="hero-sub"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            The PHED Survey &amp; Notice Distribution System — ward-by-ward field surveys,
            digitised records and citizen notices for Thanesar, in one place.
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          {loginCard}
        </motion.div>
      </div>

      <div className="scroll-cue" aria-hidden="true">
        <span>Scroll</span>
        <span className="scroll-cue-line" />
      </div>
    </section>
  );
}
