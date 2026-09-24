import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Loader2, Lock, MapPin, Search } from 'lucide-react';
import { useCitywidePropertySearch } from '../../hooks/useCitywidePropertySearch';
import OfficeDocumentReceiptForm from './OfficeDocumentReceiptForm';
import EmployeeLayout from '../../components/EmployeeLayout';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { ConnectionAvailability } from '../../components/ConnectionStatus';

const connectionText = (consumer) => (consumer.connections || [])
  .map((connection) => `${connection.service}: ${connection.connection_number}`)
  .join(' · ');

const hasService = (consumer, service) => (consumer.connections || [])
  .some((connection) => connection.service === service && connection.connection_number);

export default function PhedConsumerPropertyLinker({ consumer, H, onBack, onSaved }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [showDocuments, setShowDocuments] = useState(false);
  const searchInputRef = useRef(null);
  const { results: matches, loading, error, total, page, pages, loadMore, retry } = useCitywidePropertySearch(query);
  const isLinked = Boolean(consumer.linked_property_id);
  const linkedProperty = consumer.linked_property || null;

  const chooseProperty = (property) => {
    searchInputRef.current?.blur();
    setSelectedProperty(property);
  };

  if (showDocuments && selectedProperty) {
    return <OfficeDocumentReceiptForm consumer={consumer} property={selectedProperty} H={H} onBack={() => setShowDocuments(false)} onSaved={onSaved} />;
  }

  // A link is not an approval. Linked records still have an accessible survey workflow.
  if (isLinked) {
    return (
      <EmployeeLayout title="Linked record">
        <div className="mx-auto max-w-md space-y-4" data-testid="phed-consumer-linked-locked">
          <Button variant="ghost" onClick={onBack} data-testid="back-to-phed-consumers-button">
            <ArrowLeft className="mr-1 h-4 w-4" /> PHED consumers
          </Button>

          <div className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800" data-testid="linked-locked-banner">
            <Lock className="h-4 w-4 shrink-0" />
            <span data-testid="linked-consumer-survey-status">Property ID linked · {consumer.survey_status || 'Survey not started'}</span>
          </div>

          <Card className="clinic-card border-green-200" data-testid="selected-phed-consumer-card">
            <CardContent className="space-y-2 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">PHED Excel record</p>
              <p className="truncate font-semibold" style={{ color: 'var(--phed-ink)' }}>{consumer.consumer_name || '—'}</p>
              <p className="font-mono text-xs text-slate-500" data-testid="linked-consumer-id">Consumer ID: {consumer.consumer_id || '—'}</p>
              <p className="text-xs text-slate-500">{consumer.address || '—'} · {consumer.locality || consumer.colony_name || '—'}</p>
              <p className="text-xs text-slate-500">{connectionText(consumer) || 'No connection number in this PHED record'}</p>
              <ConnectionAvailability water={hasService(consumer, 'Water')} sewer={hasService(consumer, 'Sewer')} testId="linked-consumer-availability" />
            </CardContent>
          </Card>

          <Card className="clinic-card border-green-200" data-testid="linked-property-card">
            <CardContent className="space-y-1 p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">Linked property</p>
              <p className="font-mono text-sm font-semibold text-blue-700" data-testid="linked-property-id">{linkedProperty?.property_id || consumer.linked_property_number || '—'}</p>
              {linkedProperty && (
                <>
                  <p className="text-sm" style={{ color: 'var(--phed-ink)' }} data-testid="linked-property-owner">{linkedProperty.owner_name || '—'}</p>
                  <p className="flex items-center gap-1 text-xs text-slate-500" data-testid="linked-property-colony"><MapPin className="h-3.5 w-3.5 shrink-0" />{linkedProperty.colony || '—'}</p>
                </>
              )}
              {consumer.office_document_receipt && (
                <div className="mt-2 rounded-md bg-teal-50 p-2 text-xs text-teal-800" data-testid="linked-office-document-receipt">
                  <p className="font-semibold">{consumer.office_document_receipt.status}</p>
                  {consumer.office_document_receipt.remarks && <p className="mt-1 whitespace-pre-wrap">{consumer.office_document_receipt.remarks}</p>}
                </div>
              )}
            </CardContent>
          </Card>

          <Button className="w-full" onClick={() => navigate(`/employee/phed-survey/${consumer.linked_property_id}`)} data-testid="linked-consumer-open-survey"><FileText className="h-4 w-4 mr-2" />{consumer.survey_status === 'Approved' ? 'View approved survey' : 'Open survey'}</Button>
          <Button variant="outline" className="w-full" onClick={onBack} data-testid="linked-locked-back-button">वापस जाएँ</Button>
        </div>
      </EmployeeLayout>
    );
  }

  return (
    <EmployeeLayout title="Property search">
      <div className="mx-auto max-w-md space-y-4" data-testid="phed-consumer-property-linker">
        <Button variant="ghost" onClick={onBack} data-testid="back-to-phed-consumers-button">
          <ArrowLeft className="mr-1 h-4 w-4" /> PHED consumers
        </Button>

        <Card className="clinic-card" data-testid="selected-phed-consumer-card">
          <CardContent className="space-y-2 p-4">
            <p className="text-xs font-semibold uppercase text-slate-500">Selected PHED Excel record</p>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold" style={{ color: 'var(--phed-ink)' }}>
                  {consumer.consumer_name || '—'}
                </p>
                <p className="font-mono text-xs text-slate-500" data-testid="selected-phed-consumer-id">
                  Consumer ID: {consumer.consumer_id || '—'}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {consumer.category || 'PHED'}
              </Badge>
            </div>
            <p className="text-xs text-slate-500" data-testid="selected-phed-consumer-address">
              {consumer.address || '—'} · {consumer.locality || consumer.colony_name || '—'}
            </p>
            <p className="text-xs text-slate-500" data-testid="selected-phed-consumer-connections">
              {connectionText(consumer) || 'No connection number in this PHED record'}
            </p>
            <ConnectionAvailability
              water={hasService(consumer, 'Water')}
              sewer={hasService(consumer, 'Sewer')}
              testId="selected-phed-consumer-availability"
            />
          </CardContent>
        </Card>

        <section>
          <label htmlFor="city-property-search" className="text-sm font-semibold" style={{ color: 'var(--phed-ink)' }}>
            Search property tax data
          </label>
          <p className="mt-1 text-xs text-slate-500" data-testid="citywide-property-search-hint">All colonies in your city · Property ID, mobile number or owner name</p>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedProperty(null);
              }}
              id="city-property-search"
              placeholder="Property ID, mobile number or owner name"
              maxLength={200}
              className="h-11 pl-9"
              data-testid="attach-property-search-input"
            />
          </div>
          {loading && <p className="mt-2 flex items-center gap-2 text-xs text-slate-500" data-testid="attach-property-loading"><Loader2 className="h-4 w-4 animate-spin" /> Searching city records…</p>}
          {error && <div className="mt-2 text-sm text-red-700" role="alert" data-testid="attach-property-error">{error}<Button variant="ghost" onClick={retry} data-testid="retry-attach-property-search">Try again</Button></div>}
          {query.trim() && !loading && !error && matches.length === 0 && (
            <p className="mt-2 text-xs text-slate-500" data-testid="attach-property-empty-state">
              No property found in this city for this ID, mobile number or owner name.
            </p>
          )}
          {matches.length > 0 && <p className="mt-2 text-xs text-slate-500" data-testid="attach-property-result-count">Showing {matches.length} of {total} citywide matches</p>}
          <div className="mt-2 space-y-2" data-testid="attach-property-results">
            {matches.map((property) => (
              <button
                type="button"
                key={property.id}
                onClick={() => chooseProperty(property)}
                className={`w-full border p-3 text-left transition-colors ${
                  selectedProperty?.id === property.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 bg-white hover:border-blue-300'
                }`}
                data-testid={`attach-property-result-${property.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-blue-700" data-testid={`attach-property-id-${property.id}`}>
                    {property.property_id}
                  </span>
                  <Badge variant="outline" className="text-[10px]" data-testid={`attach-property-ward-${property.id}`}>Colony: {property.colony || property.ward || '—'}</Badge>
                </div>
                <p className="mt-1 truncate text-sm" style={{ color: 'var(--phed-ink)' }} data-testid={`attach-property-owner-${property.id}`}>
                  {property.owner_name || '—'}
                </p>
                <p className="mt-1 text-xs text-slate-600" data-testid={`attach-property-mobile-${property.id}`}>Mobile: {property.mobile || 'Not available'}</p>
                <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500" data-testid={`attach-property-address-${property.id}`}>
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {property.address || '—'} · {property.colony || '—'}
                </p>
              </button>
            ))}
          </div>
          {page < pages && <Button variant="outline" className="mt-3 w-full" disabled={loading} onClick={loadMore} data-testid="load-more-attach-properties">Load more properties</Button>}
        </section>

        <Button
          className="h-11 w-full text-white"
          style={{ background: 'var(--phed-teal)' }}
          onClick={() => setShowDocuments(true)}
          disabled={!selectedProperty}
          data-testid="continue-to-document-submission-button"
        >
          <FileText className="mr-2 h-4 w-4" /> Continue to document submission
        </Button>
      </div>
    </EmployeeLayout>
  );
}