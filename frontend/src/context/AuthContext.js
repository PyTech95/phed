import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { toast } from 'sonner';

const AuthContext = createContext(null);

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

// Auto-logout after 10 minutes of inactivity
const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds
const IDLE_WARNING_MS = 60 * 1000;

let refreshPromise = null;
async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) throw new Error('no refresh token');
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken }, { _skipAuthRefresh: true })
      .then((res) => {
        localStorage.setItem('token', res.data.token);
        return res.data.token;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

// On 401 (expired access token) silently refresh once and replay the request
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error?.response?.status;
    const isAuthRoute = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');
    if (status === 401 && original && !original._retried && !original._skipAuthRefresh && !isAuthRoute && localStorage.getItem('refreshToken')) {
      original._retried = true;
      try {
        const newToken = await refreshAccessToken();
        original.headers = { ...(original.headers || {}), Authorization: `Bearer ${newToken}` };
        window.dispatchEvent(new CustomEvent('auth:token-refreshed', { detail: newToken }));
        return axios(original);
      } catch {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('cachedUser');
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }
    }
    return Promise.reject(error);
  }
);

export function AuthProvider({ children }) {
  // Instantly restore cached user to prevent flash-redirect on mobile camera return
  const [user, setUser] = useState(() => {
    try {
      const cached = localStorage.getItem('cachedUser');
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);
  const idleTimerRef = useRef(null);
  const warnTimerRef = useRef(null);
  const warnToastRef = useRef(null);

  // Helper to update user + cache
  const setUserAndCache = useCallback((userData) => {
    setUser(userData);
    if (userData) {
      localStorage.setItem('cachedUser', JSON.stringify(userData));
    } else {
      localStorage.removeItem('cachedUser');
    }
  }, []);

  // Reset idle timer (gentle warning 60s before sign-out, toast instead of blocking alert)
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    if (warnToastRef.current) { toast.dismiss(warnToastRef.current); warnToastRef.current = null; }
    
    // Only set timer if user is logged in
    if (token) {
      warnTimerRef.current = setTimeout(() => {
        warnToastRef.current = toast.warning('Still there? You will be signed out in 1 minute due to inactivity.', {
          id: 'idle-warning',
          duration: IDLE_WARNING_MS,
          action: { label: 'Stay signed in', onClick: () => resetIdleTimer() },
        });
      }, IDLE_TIMEOUT - IDLE_WARNING_MS);
      idleTimerRef.current = setTimeout(() => {
        logout();
        sessionStorage.setItem('signedOutReason', 'idle');
        window.location.href = '/login';
      }, IDLE_TIMEOUT);
    }
  }, [token]);

  // Set up activity listeners
  useEffect(() => {
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    
    const handleActivity = () => {
      resetIdleTimer();
    };

    // Add event listeners
    activityEvents.forEach(event => {
      document.addEventListener(event, handleActivity);
    });

    // Start the timer
    resetIdleTimer();

    // Cleanup
    return () => {
      activityEvents.forEach(event => {
        document.removeEventListener(event, handleActivity);
      });
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      if (warnTimerRef.current) clearTimeout(warnTimerRef.current);
    };
  }, [resetIdleTimer]);

  useEffect(() => {
    const onRefreshed = (e) => {
      setToken(e.detail);
      toast.message('Session refreshed', { id: 'session-refreshed', description: 'You were kept signed in securely.', duration: 2500 });
    };
    const onExpired = () => {
      setToken(null); setUser(null);
      sessionStorage.setItem('signedOutReason', 'expired');
      toast.info('Signing you out', { id: 'session-expired', description: 'Your session expired. Please sign in again.' });
    };
    window.addEventListener('auth:token-refreshed', onRefreshed);
    window.addEventListener('auth:session-expired', onExpired);
    return () => {
      window.removeEventListener('auth:token-refreshed', onRefreshed);
      window.removeEventListener('auth:session-expired', onExpired);
    };
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      const savedToken = localStorage.getItem('token');
      if (savedToken) {
        // If we already have cached user, stop loading immediately
        // This prevents redirect flash on mobile camera return
        const hasCachedUser = !!localStorage.getItem('cachedUser');
        if (hasCachedUser) {
          setLoading(false);
        }
        
        try {
          const response = await axios.get(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${savedToken}` }
          });
          setUserAndCache(response.data);
          setToken(localStorage.getItem('token'));
        } catch (error) {
          // CRITICAL: Only clear auth on explicit 401/403 rejection from server
          // Network errors (timeout, offline) should NOT log user out
          // This prevents mobile camera return from killing the session
          const status = error?.response?.status;
          if (status === 401 || status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('cachedUser');
            setToken(null);
            setUser(null);
          }
          // On network error: keep cached user & token intact
        }
      }
      setLoading(false);
    };
    initAuth();
  }, []);

  const login = async (username, password) => {
    const response = await axios.post(`${API_URL}/auth/login`, { username, password });
    const { token: newToken, refresh_token: newRefresh, user: userData } = response.data;
    localStorage.setItem('token', newToken);
    if (newRefresh) localStorage.setItem('refreshToken', newRefresh);
    setToken(newToken);
    
    // Fetch computed permissions from /auth/me
    try {
      const meResponse = await axios.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${newToken}` }
      });
      setUserAndCache(meResponse.data);
    } catch {
      setUserAndCache(userData);
    }
    
    resetIdleTimer();
    return userData;
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('cachedUser');
    setToken(null);
    setUser(null);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
  };

  const getAuthHeader = () => {
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, getAuthHeader }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
