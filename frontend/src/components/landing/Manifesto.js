import Reveal from './Reveal';

const CHAPTERS = [
  {
    num: '01',
    title: 'Ground Truth',
    text: 'Field teams walk every ward of Thanesar, recording each property and each water connection exactly as it stands — no estimates, no guesswork.',
  },
  {
    num: '02',
    title: 'Digital Record',
    text: 'Surveys, notices and consumer data become searchable digital records in seconds, replacing registers that took days to reconcile.',
  },
  {
    num: '03',
    title: 'Citizen Service',
    text: 'Accurate books mean faster resolutions, fairer billing and notices that reach every household on time.',
  },
];

export default function Manifesto() {
  return (
    <section className="manifesto" data-testid="manifesto-section">
      <div className="mani-inner">
        <Reveal>
          <p className="ld-kicker ld-kicker--ink">The Work</p>
        </Reveal>
        <Reveal delay={0.08}>
          <h2 className="mani-title">Three promises, <em>kept daily.</em></h2>
        </Reveal>
        <div style={{ marginTop: 56 }}>
          {CHAPTERS.map((c, i) => (
            <Reveal key={c.num} delay={0.06 * i}>
              <div className="chapter" data-testid={`manifesto-chapter-${c.num}`}>
                <span className="chapter-num">{c.num}</span>
                <h3 className="chapter-title">{c.title}</h3>
                <p className="chapter-text">{c.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
