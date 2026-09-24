import { motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { partners } from '../../constants/partners';
import Reveal from './Reveal';

function PartnerTile({ partner, index }) {
  const inner = (
    <>
      {partner.website && <ArrowUpRight className="partner-ext" size={14} />}
      {partner.logoUrl ? (
        <img className="partner-logo" src={partner.logoUrl} alt={partner.name} loading="lazy" />
      ) : (
        <span className="partner-mono" role="img" aria-label={partner.name}>{partner.initials}</span>
      )}
      <span className="partner-name">{partner.name}</span>
    </>
  );
  const motionProps = {
    initial: { opacity: 0, y: 22 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-60px' },
    transition: { duration: 0.7, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] },
  };
  const className = 'partner-tile';
  const testId = `partner-tile-${partner.id}`;
  if (partner.website) {
    return (
      <motion.a
        {...motionProps}
        href={partner.website}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        data-testid={testId}
        aria-label={`${partner.name} (opens in new tab)`}
      >
        {inner}
      </motion.a>
    );
  }
  return (
    <motion.div {...motionProps} className={className} data-testid={testId}>
      {inner}
    </motion.div>
  );
}

export default function TrustedBy() {
  if (!partners || partners.length === 0) return null;
  return (
    <section className="trusted" data-testid="trusted-by-section" aria-labelledby="trusted-by-title">
      <div className="trusted-inner">
        <Reveal>
          <p className="ld-kicker" data-testid="trusted-by-kicker">Hanno Creduto in Noi</p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 id="trusted-by-title" className="trusted-title">They believed <em>in us.</em></h2>
        </Reveal>
        <Reveal delay={0.16}>
          <p className="trusted-sub">
            Institutions and civic bodies that have placed their trust in the department's work.
          </p>
        </Reveal>
        <div className="trusted-grid" data-testid="trusted-by-grid">
          {partners.map((p, i) => (
            <PartnerTile key={p.id} partner={p} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
