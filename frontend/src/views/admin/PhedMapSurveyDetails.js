import { Droplet, FileText, MapPin } from 'lucide-react';
import { Badge } from '../../components/ui/badge';

const decisionLabel = (survey) => {
  const water = survey?.water || {};
  if (water.property_locked) return 'Property Locked';
  if (water.owner_denied) return 'Owner Denied';
  if (water.owner_change === 'DEATH_TRANSFER') return 'Death Transfer';
  if (water.owner_change === 'OWNERSHIP_CHANGE') return 'Ownership Change';
  if (water.new_connection || survey?.survey_type === 'NO_CONNECTION') return 'New Connection';
  const hasWater = (water.connection_numbers || []).length > 0;
  const hasSewer = water.has_sewer || (water.sewer_connection_numbers || []).length > 0;
  if (hasWater && hasSewer) return 'Water + Sewer Connection';
  if (hasSewer) return 'Sewer Connection';
  if (hasWater || water.has_connection || survey?.survey_type === 'WATER_CONNECTION') {
    return 'Already Connection';
  }
  return 'PHED survey recorded';
};

const dateText = (value) => {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const connectionText = (consumer) => (consumer?.connections || [])
  .map((connection) => `${connection.service}: ${connection.connection_number}`)
  .join(' · ');

export default function PhedMapSurveyDetails({ detail, fallbackProperty }) {
  const property = detail?.property || fallbackProperty || {};
  const survey = detail?.survey || null;
  const water = survey?.water || {};
  const consumers = detail?.consumers || [];
  const consumer = consumers[0] || null;
  const waterNumbers = (water.connection_numbers || []).join(', ');
  const sewerNumbers = (water.sewer_connection_numbers || []).join(', ');

  return (
    <div className="space-y-4 text-sm" data-testid="phed-map-survey-details">
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-b pb-3"
        style={{ borderColor: 'var(--phed-border)' }}
      >
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Property survey review</p>
          <p className="mt-1 font-mono text-base font-bold text-blue-700">
            {property.property_id || '—'}
          </p>
        </div>
        <Badge variant="outline" data-testid="phed-map-surveyor-decision">
          {decisionLabel(survey)}
        </Badge>
      </div>

      <section
        className="border p-4"
        style={{ borderColor: 'var(--phed-border)' }}
        data-testid="map-mc-property-details"
      >
        <h3 className="mb-3 flex items-center gap-2 font-semibold" style={{ color: 'var(--phed-ink)' }}>
          <MapPin className="h-4 w-4 text-blue-600" /> MC property details
        </h3>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <DetailLine label="Property ID" value={property.property_id} testid="map-mc-property-id" mono />
          <DetailLine label="Owner name" value={property.owner_name} testid="map-mc-owner-name" />
          <DetailLine label="Mobile" value={property.mobile} testid="map-mc-mobile" mono />
          <DetailLine label="Ward" value={property.ward} testid="map-mc-ward" />
          <DetailLine label="Colony" value={property.colony} testid="map-mc-colony" />
          <DetailLine label="MC status" value={property.status} testid="map-mc-status" />
          <DetailLine label="Address" value={property.address} testid="map-mc-address" wide />
        </div>
      </section>

      <section
        className="border p-4"
        style={{ borderColor: 'var(--phed-border)' }}
        data-testid="map-phed-details"
      >
        <h3 className="mb-3 flex items-center gap-2 font-semibold" style={{ color: 'var(--phed-ink)' }}>
          <Droplet className="h-4 w-4 text-teal-600" /> PHED linked data &amp; surveyor report
        </h3>
        {consumer ? (
          <div className="mb-3 grid gap-x-6 sm:grid-cols-2" data-testid="map-phed-consumer-data">
            <DetailLine label="PHED Consumer ID" value={consumer.consumer_id} testid="map-phed-consumer-id" mono />
            <DetailLine label="PHED consumer name" value={consumer.consumer_name} testid="map-phed-consumer-name" />
            <DetailLine label="PHED mobile" value={consumer.phone || consumer.phone_masked} testid="map-phed-mobile" mono />
            <DetailLine label="PHED connections" value={connectionText(consumer)} testid="map-phed-connections" />
          </div>
        ) : (
          <p className="mb-3 text-xs text-slate-500" data-testid="map-phed-consumer-empty">
            No PHED consumer has been linked to this MC property yet.
          </p>
        )}

        {survey ? (
          <div className="border-t pt-3" style={{ borderColor: 'var(--phed-border)' }}>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <DetailLine label="Survey reference" value={survey.reference_number} testid="map-phed-survey-reference" mono />
              <DetailLine label="Survey status" value={survey.status} testid="map-phed-survey-status" />
              <DetailLine label="Surveyor" value={survey.surveyor_name} testid="map-phed-surveyor-name" />
              <DetailLine label="Submitted" value={dateText(survey.submitted_at)} testid="map-phed-submitted-at" />
              <DetailLine label="Field decision" value={decisionLabel(survey)} testid="map-phed-field-decision" wide />
              <DetailLine label="Recorded consumer ID" value={water.consumer_id} testid="map-phed-recorded-consumer-id" mono />
              <DetailLine label="Recorded name" value={water.new_owner_name || water.consumer_name} testid="map-phed-recorded-name" />
              <DetailLine label="Recorded mobile" value={water.mobile || water.phone} testid="map-phed-recorded-mobile" mono />
              <DetailLine label="Water connection" value={waterNumbers} testid="map-phed-water-numbers" wide />
              <DetailLine label="Sewer connection" value={sewerNumbers} testid="map-phed-sewer-numbers" wide />
              <DetailLine label="Remarks" value={survey.remarks || water.remarks} testid="map-phed-remarks" wide />
              <DetailLine
                label="Survey GPS"
                value={survey.latitude && survey.longitude ? `${survey.latitude}, ${survey.longitude}` : null}
                testid="map-phed-survey-gps"
                wide
                mono
              />
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500" data-testid="map-phed-document-count">
              <FileText className="h-4 w-4" />
              {survey.attachments?.length || 0} survey document(s) attached
            </div>
          </div>
        ) : (
          <p className="border-t pt-3 text-xs text-slate-500" style={{ borderColor: 'var(--phed-border)' }}>
            No PHED survey has been submitted for this property yet.
          </p>
        )}
      </section>
    </div>
  );
}

function DetailLine({ label, value, testid, mono = false, wide = false }) {
  return (
    <div className={`border-b py-2 last:border-0 ${wide ? 'sm:col-span-2' : ''}`} style={{ borderColor: 'var(--phed-border)' }}>
      <p className="text-[10px] font-semibold uppercase text-slate-500">{label}</p>
      <p className={`mt-0.5 break-words text-xs font-medium ${mono ? 'font-mono' : ''}`} data-testid={testid}>
        {value || '—'}
      </p>
    </div>
  );
}