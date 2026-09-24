const ITEMS = [
  'Har Ghar Jal',
  'Survey & Notice Distribution',
  'Ward-by-Ward Verification',
  'Digitised Records',
  'Citizen First',
  'Public Health Engineering',
];

export default function Marquee() {
  const row = [...ITEMS, ...ITEMS];
  return (
    <div className="marquee" data-testid="landing-marquee" aria-hidden="true">
      <div className="marquee-track">
        {[0, 1].map((half) => (
          <div className="marquee-item" key={half}>
            {row.map((item, i) => (
              <span key={`${half}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 56 }}>
                {item}
                <span className="marquee-dot" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
