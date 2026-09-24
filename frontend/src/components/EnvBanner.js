import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

// Shows a ribbon on every page when the backend is not running as production (e.g. staging)
export default function EnvBanner() {
  const [env, setEnv] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/health`, { _skipAuthRefresh: true })
      .then((res) => setEnv(res.data?.env || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const active = !!env && env !== 'production';
    document.body.classList.toggle('has-env-banner', active);
    return () => document.body.classList.remove('has-env-banner');
  }, [env]);

  if (!env || env === 'production') return null;

  return (
    <div
      data-testid="env-banner"
      className="fixed top-0 left-0 right-0 z-[60] h-6 flex items-center justify-center text-[11px] font-bold uppercase tracking-[0.2em] text-white"
      style={{ background: 'repeating-linear-gradient(135deg, #b45309 0 12px, #d97706 12px 24px)' }}
    >
      {env} environment — not production data
    </div>
  );
}
