import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { RefreshCw, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import EmployeeLayout from '../../components/EmployeeLayout';
import { Button } from '../../components/ui/button';
import { formatISTDateTime } from '../../lib/indianDateTime';

const API = process.env.REACT_APP_BACKEND_URL + '/api/phed';
export default function MySubmissions() {
  const { getAuthHeader } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ surveys: [], pages: 1, total: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const response = await axios.get(`${API}/surveys/mine`, { headers: getAuthHeader(), params: { page, limit: 20, status: status || undefined } });
      setData(response.data); setError('');
    } catch (e) { setError(e.response?.data?.detail || 'Submissions नहीं खुलीं। फिर कोशिश करें।'); }
    finally { setLoading(false); }
  }, [page, status, getAuthHeader]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);
  return <EmployeeLayout title="My Submissions">
    <div className="space-y-4" data-testid="my-submissions-page">
      <div className="flex items-center gap-2">
        <select className="h-10 flex-1 min-w-0 border rounded bg-white px-2 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} data-testid="my-submissions-status-filter">
          <option value="">All statuses</option>{['Draft', 'Submitted', 'Requires Review', 'Document Pending', 'Approved', 'Rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Button variant="outline" onClick={load} title="Refresh submissions" data-testid="my-submissions-refresh"><RefreshCw className="h-4 w-4" /></Button>
      </div>
      <p className="text-sm text-slate-600" data-testid="my-submissions-count">{data.total} submissions</p>
      {error && <p role="alert" className="text-red-700 text-sm" data-testid="my-submissions-error">{error}</p>}
      {loading && <p role="status" data-testid="my-submissions-loading">Loading…</p>}
      {!loading && !error && data.surveys.length === 0 && <p className="text-sm text-slate-500" data-testid="my-submissions-empty">No submissions yet.</p>}
      {data.surveys.map((survey) => <article key={survey.id} className="border rounded-lg bg-white p-4 space-y-2" data-testid={`my-submission-${survey.id}`}>
        <div className="flex flex-wrap justify-between gap-2">
          <strong className="text-sm break-all text-blue-700" data-testid={`my-submission-property-${survey.id}`}>{survey.property_id}</strong>
          <span className={`text-xs font-semibold ${survey.status === 'Approved' ? 'text-green-700' : survey.status === 'Rejected' ? 'text-red-700' : 'text-amber-700'}`} data-testid={`my-submission-status-${survey.id}`}>{survey.status}</span>
        </div>
        <p className="text-sm break-words" data-testid={`my-submission-consumer-${survey.id}`}>{survey.water?.consumer_name || survey.water?.new_owner_name || '—'} · {survey.water?.consumer_id || '—'}</p>
        <p className="text-xs text-slate-500" data-testid={`my-submission-reference-${survey.id}`}>{survey.reference_number || 'Draft'} · {survey.colony_name || '—'}</p>
        <p className="text-xs text-slate-500" data-testid={`my-submission-updated-${survey.id}`}>Updated: {formatISTDateTime(survey.updated_at)}</p>
        <p className="text-xs" data-testid={`my-submission-connection-${survey.id}`}>{survey.connection_label}</p>
        {(survey.return_reason || survey.rejection_reason) && <p className="text-sm text-red-700 break-words" data-testid={`my-submission-feedback-${survey.id}`}>{survey.return_reason || survey.rejection_reason}</p>}
        <Button variant="outline" className="w-full" onClick={() => navigate(`/employee/phed-survey/${survey.property_record_id}`, { state: { returnTo: '/employee/submissions' } })} data-testid={`my-submission-open-${survey.id}`}><FileText className="h-4 w-4 mr-2" />{survey.status === 'Approved' ? 'View survey' : 'Open survey'}</Button>
      </article>)}
      <div className="flex justify-between items-center">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="my-submissions-previous" title="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="text-xs" data-testid="my-submissions-pagination">{page} / {Math.max(1, data.pages)}</span>
        <Button variant="outline" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} data-testid="my-submissions-next" title="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  </EmployeeLayout>;
}