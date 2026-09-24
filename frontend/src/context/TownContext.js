import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from './AuthContext';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const TownContext = createContext(null);

export const useTown = () => {
  const context = useContext(TownContext);
  if (!context) throw new Error('useTown must be used within a TownProvider');
  return context;
};

export const TownProvider = ({ children }) => {
  const { token } = useAuth();
  const [towns, setTowns] = useState([]);
  const [selectedTown, setSelectedTown] = useState(null);
  const [loading, setLoading] = useState(true);
  const [validatedToken, setValidatedToken] = useState(undefined);
  const [townRequired, setTownRequired] = useState(false);
  const requestRef = useRef(0);

  const selectTown = useCallback((town) => {
    setSelectedTown(town);
    setTownRequired(!town);
    if (town) localStorage.setItem('selectedTown', JSON.stringify(town));
    else localStorage.removeItem('selectedTown');
  }, []);

  const fetchTowns = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const { data } = token
        ? await axios.get(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        : await axios.get(`${API_URL}/towns`);
      if (requestId !== requestRef.current) return;
      const available = token ? (data.accessible_towns || []) : (data.towns || []);
      setTowns(available);
      let saved;
      try { saved = JSON.parse(localStorage.getItem('selectedTown')); } catch { /* validate below */ }
      // Never carry a previous account's inaccessible town into a new session.
      const valid = available.find((town) => town.id === saved?.id);
      selectTown(token ? (valid || (available.length === 1 ? available[0] : null)) : null);
    } catch (error) {
      if (requestId !== requestRef.current) return;
      console.error('Failed to fetch accessible towns:', error);
      // Do not turn an authenticated lookup failure into public/all-town access.
      setTowns([]);
      selectTown(null);
    } finally {
      if (requestId === requestRef.current) {
        setValidatedToken(token);
        setLoading(false);
      }
    }
  }, [token, selectTown]);

  useEffect(() => {
    fetchTowns();
    return () => { requestRef.current += 1; };
  }, [fetchTowns]);

  const value = {
    towns, selectedTown, loading: loading || validatedToken !== token, townRequired,
    selectTown, clearTown: () => selectTown(null),
    hasTownContext: () => selectedTown !== null,
    getTownId: () => selectedTown?.id || null,
    getTownCode: () => selectedTown?.code || null,
    getTownHeaders: () => selectedTown ? { 'X-Town-ID': selectedTown.id, 'X-Town-Code': selectedTown.code } : {},
    refreshTowns: fetchTowns,
  };
  return <TownContext.Provider value={value}>{children}</TownContext.Provider>;
};

export default TownContext;