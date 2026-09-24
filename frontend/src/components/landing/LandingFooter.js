export default function LandingFooter() {
  return (
    <footer className="ld-footer" data-testid="landing-footer">
      <div className="ld-footer-inner">
        <div className="ld-footer-brand">
          <img src="/phed-logo.png" alt="Public Health Engineering Department (PHED)" />
          <div>
            <p className="ld-footer-name">Public Health Engineering Department</p>
            <p className="ld-footer-sub">Survey &amp; Notice Distribution System — Thanesar</p>
          </div>
        </div>
        <p className="ld-footer-note">Authorised personnel only · {new Date().getFullYear()}</p>
      </div>
    </footer>
  );
}
