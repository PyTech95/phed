import { useEffect, useRef } from 'react';

export const useLiveRefresh = (refresh, enabled = true) => {
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    if (!enabled) return undefined;
    const run = () => { if (!document.hidden) callback.current(); };
    const timer = setInterval(run, 15000);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [enabled]);
};