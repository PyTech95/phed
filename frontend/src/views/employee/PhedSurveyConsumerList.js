import { Loader2, MapPin, Search, UserRoundPlus } from 'lucide-react';
import EmployeeLayout from '../../components/EmployeeLayout';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

const connectionText = (consumer) => (consumer.connections || [])
  .map((connection) => `${connection.service}: ${connection.connection_number}`)
  .join(' · ');

export default function PhedSurveyConsumerList({
  consumers,
  loading,
  error,
  search,
  onSearchChange,
  unlinkedOnly,
  onUnlinkedOnlyChange,
  stats,
  onChooseConsumer,
  onLoadMore,
}) {
  const rows = consumers || [];
  return (
    <EmployeeLayout title="Water Supply Survey">
      <div className="mx-auto max-w-md" data-testid="phed-survey-consumer-list">
        <section
          className="mb-4 flex items-center justify-between rounded-xl p-3 text-white"
          style={{ background: 'var(--phed-blue)' }}
          data-testid="phed-consumer-progress"
        >
          <div>
            <div className="text-2xl font-bold leading-none" data-testid="phed-unlinked-count">
              {stats.unlinked_total ?? '…'}
            </div>
            <div className="text-xs opacity-90">PHED records need a Property ID link</div>
          </div>
          <div className="text-right text-xs opacity-90" data-testid="phed-consumer-total-count">
            <div className="font-semibold">PHED Excel data</div>
            <div>{stats.total ?? '…'} records</div>
          </div>
        </section>

        <div className="relative mb-2">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            className="h-11 pl-9"
            placeholder="Search Consumer ID, connection no., phone, name…"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            data-testid="phed-consumer-search-input"
          />
        </div>

        <div className="mb-4 flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => onUnlinkedOnlyChange(true)}
            className={`h-8 rounded-full border px-3 ${
              unlinkedOnly
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 text-slate-600'
            }`}
            data-testid="phed-consumer-filter-needs-link"
          >
            Needs Property Link
          </button>
          <button
            type="button"
            onClick={() => onUnlinkedOnlyChange(false)}
            className={`h-8 rounded-full border px-3 ${
              !unlinkedOnly
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 text-slate-600'
            }`}
            data-testid="phed-consumer-filter-all"
          >
            All PHED data
          </button>
        </div>

        {error && <p className="mb-3 text-sm text-red-700" data-testid="phed-consumer-load-error">{error}</p>}
        {loading && rows.length === 0 && (
          <div className="py-16 text-center" data-testid="phed-consumer-loading">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />
          </div>
        )}
        {!loading && rows.length === 0 && (
          <Card className="clinic-card" data-testid="phed-consumer-empty-state">
            <CardContent className="py-12 text-center text-sm text-slate-500">
              {search.trim()
                ? `No PHED Excel record found for "${search}".`
                : 'No PHED consumer records are available for this filter.'}
            </CardContent>
          </Card>
        )}
        <div className="space-y-2.5">
          {rows.map((consumer) => {
            const isLinked = Boolean(consumer.linked_property_id);
            return (
              <button
                type="button"
                key={consumer.id}
                onClick={() => onChooseConsumer(consumer)}
                className="clinic-card w-full cursor-pointer border p-4 text-left transition-shadow hover:shadow-md"
                data-testid={`phed-consumer-row-${consumer.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold" style={{ color: 'var(--phed-ink)' }}>
                      {consumer.consumer_name || '—'}
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-500">
                      {consumer.consumer_id || '—'}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">
                      {connectionText(consumer) || 'No connection number'}
                    </div>
                    <div className="mt-1 flex items-center gap-1 truncate text-xs text-slate-500">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      {consumer.address || '—'} · {consumer.locality || consumer.colony_name || '—'}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] ${
                      isLinked ? 'border-green-300 text-green-700' : 'border-amber-300 text-amber-700'
                    }`}
                    data-testid={`phed-consumer-link-status-${consumer.id}`}
                  >
                    {isLinked ? 'Property linked' : 'Attach Property ID'}
                  </Badge>
                </div>
              </button>
            );
          })}
        </div>
        {stats.page < stats.pages && (
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={onLoadMore}
            disabled={loading}
            data-testid="load-more-phed-consumers-button"
          >
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserRoundPlus className="mr-2 h-4 w-4" />}
            Load more PHED records
          </Button>
        )}
      </div>
    </EmployeeLayout>
  );
}