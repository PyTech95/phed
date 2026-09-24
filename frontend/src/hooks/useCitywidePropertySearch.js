import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useTown } from '../context/TownContext';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';

export function useCitywidePropertySearch(query) {
  const { token } = useAuth();
  const { selectedTown } = useTown();
  const townCode = selectedTown?.code;
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 0, pages: 0, total: 0 });
  const requestRef = useRef(0);

  const fetchPage = useCallback(async (page, signal) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${API_URL}/employee/properties/search`, {
        headers: { Authorization: `Bearer ${token}`, ...(townCode ? { 'X-Town-Code': townCode } : {}) },
        params: { search: query.trim(), page, limit: 25 },
        signal,
      });
      if (requestId !== requestRef.current) return;
      setResults((current) => page === 1 ? data.properties : [...current, ...data.properties]);
      setMeta({ page: data.page, pages: data.pages, total: data.total });
    } catch (err) {
      if (requestId === requestRef.current && !axios.isCancel(err)) {
        setError('Citywide search could not load. Please try again.');
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [query, token, townCode]);

  useEffect(() => {
    setResults([]);
    setMeta({ page: 0, pages: 0, total: 0 });
    setError('');
    setLoading(Boolean(query.trim()));
    const controller = new AbortController();
    const timer = query.trim() ? setTimeout(() => fetchPage(1, controller.signal), 300) : null;
    return () => {
      ++requestRef.current;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, fetchPage]);

  const loadMore = () => {
    if (!loading && meta.page < meta.pages) fetchPage(meta.page + 1);
  };
  const retry = () => {
    if (!loading && query.trim()) fetchPage(meta.page ? meta.page + 1 : 1);
  };
  return { results, loading, error, ...meta, loadMore, retry };
}
