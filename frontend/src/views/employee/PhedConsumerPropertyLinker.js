import { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { ArrowLeft, Link2, Loader2, MapPin, Search } from 'lucide-react';
import { toast } from 'sonner';
import EmployeeLayout from '../../components/EmployeeLayout';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

const API_URL = process.env.REACT_APP_BACKEND_URL + '/api';
const PHED = `${API_URL}/phed`;

const connectionText = (consumer) => (consumer.connections || [])
  .map((connection) => `${connection.service}: ${connection.connection_number}`)
  .join(' · ');

export default function PhedConsumerPropertyLinker({
  consumer,
  properties,
  H,
  onBack,
  onAttached,
}) {
  const [query, setQuery] = useState('');
  const [selectedProperty, setSelectedProperty] = useState(null);
  const [attaching, setAttaching] = useState(false);
  const searchInputRef = useRef(null);

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return (properties || []).filter((property) => (
      (property.property_id || '').toLowerCase().includes(term)
    )).slice(0, 25);
  }, [properties, query]);

  const chooseProperty = (property) => {
    searchInputRef.current?.blur();
    setSelectedProperty(property);
  };

  const attachProperty = async () => {
    if (!selectedProperty) {
      toast.error('पहले Property ID search करके एक property चुनें।');
      return;
    }
    setAttaching(true);
    try {
      await axios.post(
        `${PHED}/consumers/${consumer.id}/link`,
        { property_record_id: selectedProperty.id, confirm: true },
        H(),
      );
      toast.success(`Property ID ${selectedProperty.property_id} attach हो गई।`);
      onAttached(selectedProperty, consumer);
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Property attach नहीं हो सकी।');
    } finally {
      setAttaching(false);
    }
  };

  return (
    <EmployeeLayout title="Attach Property ID">
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
          </CardContent>
        </Card>

        <section>
          <label className="text-sm font-semibold" style={{ color: 'var(--phed-ink)' }}>
            Search MC Property ID to attach
          </label>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedProperty(null);
              }}
              placeholder="Enter Property ID, e.g. 3UV..."
              className="h-11 pl-9"
              data-testid="attach-property-search-input"
            />
          </div>
          {query.trim() && matches.length === 0 && (
            <p className="mt-2 text-xs text-slate-500" data-testid="attach-property-empty-state">
              No assigned MC property found with this Property ID.
            </p>
          )}
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
                  <span className="font-mono text-sm font-semibold text-blue-700">
                    {property.property_id}
                  </span>
                  <Badge variant="outline" className="text-[10px]">Ward {property.ward || '—'}</Badge>
                </div>
                <p className="mt-1 truncate text-sm" style={{ color: 'var(--phed-ink)' }}>
                  {property.owner_name || '—'}
                </p>
                <p className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {property.address || '—'} · {property.colony || '—'}
                </p>
              </button>
            ))}
          </div>
        </section>

        <Button
          className="h-11 w-full text-white"
          style={{ background: 'var(--phed-teal)' }}
          onClick={attachProperty}
          disabled={!selectedProperty || attaching}
          data-testid="attach-selected-property-button"
        >
          {attaching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
          Attach selected Property ID
        </Button>
      </div>
    </EmployeeLayout>
  );
}