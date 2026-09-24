import { CONNECTION_TYPES, connectionCode } from './connectionStatus';
import { formatISTDateTime } from './indianDateTime';

const esc = (v) => String(v ?? '—').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rows = (pairs) => pairs.map(([l, v]) => `<tr><th>${esc(l)}</th><td>${esc(v)}</td></tr>`).join('');

const DOC_LABEL = {
  APPLICATION: 'Application photo', AADHAAR: 'Aadhaar', AADHAAR_FRONT: 'Aadhaar (front)', AADHAAR_BACK: 'Aadhaar (back)',
  PROPERTY_PROOF: 'Property proof', PROPERTY_FRONT: 'Property photo', HOUSE_PHOTO: 'House photo (with owner)',
  DEATH_CERTIFICATE: 'Death certificate', BILL: 'Water/Sewer bill', REGISTRY: 'Registry', OTHER: 'Other',
};
const OWNER_CHANGE_LABEL = { DEATH_TRANSFER: 'Death transfer', OWNERSHIP_CHANGE: 'Ownership change' };

export function printSurveySheet({ survey, property, consumers = [] }) {
  if (!survey) return;
  const w = survey.water || {};
  const decision = CONNECTION_TYPES[connectionCode(survey)]?.label || '—';
  const mcRows = rows([
    ['Property ID', property?.property_id],
    ['Owner name', property?.owner_name],
    ['Mobile', property?.mobile],
    ['Ward', property?.ward],
    ['Colony', property?.colony],
    ['Address', property?.address],
    ['Serial number', property?.serial_number],
    ['MC property status', property?.status],
  ]);
  const phedRows = rows([
    ['Field decision', decision],
    ['Surveyor', survey.surveyor_name],
    ['Submitted (IST)', formatISTDateTime(survey.submitted_at)],
    ['Ward', survey.ward_number],
    ['Colony', survey.colony_name],
    ['PHED consumer ID', w.new_connection || survey.survey_type === 'NO_CONNECTION' ? 'New Connection' : w.consumer_id],
    ['PHED consumer name', w.new_owner_name || w.consumer_name],
    ['Office documents received', w.office_document_status],
    ['Mobile', w.mobile || w.phone],
    ['Alternate mobile', w.alternate_mobile],
    ['Category', w.category],
    ['Water connections', (w.connection_numbers || []).join(', ')],
    ['Sewer connections', (w.sewer_connection_numbers || []).join(', ')],
    ['Owner change', w.owner_change ? (OWNER_CHANGE_LABEL[w.owner_change] || w.owner_change) : ''],
    ['New owner', w.new_owner_name],
    ['New address', w.new_address],
    ['Status', survey.status],
  ]);
  const linked = consumers.length === 0 ? '<p class="muted">No linked PHED consumer.</p>' : consumers.map((c) => (
    `<div class="linked"><b>${esc(c.consumer_name)}</b> <span class="mono">${esc(c.consumer_id)}</span>
      ${(c.connections || []).map((cn) => `<span class="chip">${esc(cn.service)} · ${esc(cn.connection_number)}</span>`).join('')}</div>`
  )).join('');
  const docs = (survey.attachments || []).length
    ? `<ul>${survey.attachments.map((a) => `<li>${esc(DOC_LABEL[a.attachment_type] || a.attachment_type)} — ${esc(a.filename)}</li>`).join('')}</ul>`
    : '<p class="muted">No documents attached.</p>';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>PHED Survey ${esc(survey.property_id || '')}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; }
    h1 { font-size: 18px; margin: 0; }
    .head { border-bottom: 2px solid #1565C0; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; }
    .sub { font-size: 11px; color: #4b5563; }
    .grid { display: flex; gap: 12px; }
    .box { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; }
    .box h2 { font-size: 13px; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 1px solid #cbd5e1; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; font-size: 11px; padding: 4px 2px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
    th { color: #6b7280; font-weight: 500; width: 42%; }
    td { font-weight: 600; }
    .section { margin-top: 12px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; }
    .section h2 { font-size: 12px; margin: 0 0 6px; }
    .muted { color: #6b7280; font-size: 11px; }
    .mono { font-family: monospace; color: #475569; }
    .chip { border: 1px solid #cbd5e1; border-radius: 4px; padding: 1px 5px; font-size: 10px; margin-left: 4px; font-family: monospace; }
    .linked { font-size: 11px; padding: 3px 0; border-bottom: 1px solid #eef2f7; }
    ul { margin: 4px 0 0 16px; padding: 0; font-size: 11px; }
    .sign { margin-top: 26px; display: flex; gap: 24px; font-size: 11px; }
    .sign div { flex: 1; border-top: 1px solid #111827; padding-top: 4px; text-align: center; }
    .decision { display: inline-block; background: #eff6ff; border: 1px solid #1565C0; color: #1565C0; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: 700; }
  </style></head><body>
    <div class="head">
      <div>
        <h1>PHED Property Survey — Verification Sheet</h1>
        <div class="sub">Property ID: <b>${esc(survey.property_id)}</b> · Reference: <b>${esc(survey.reference_number)}</b></div>
      </div>
      <div class="sub">Printed: ${esc(formatISTDateTime(new Date().toISOString()))}<br/><span class="decision">${esc(decision)}</span></div>
    </div>
    <div class="grid">
      <div class="box"><h2>MC property data</h2><table>${mcRows}</table></div>
      <div class="box"><h2>PHED &amp; surveyor data</h2><table>${phedRows}</table></div>
    </div>
    <div class="section"><h2>Linked PHED master data</h2>${linked}</div>
    <div class="section"><h2>Remarks</h2><p class="muted">${esc(survey.remarks || '—')}</p></div>
    <div class="section"><h2>Documents (${(survey.attachments || []).length})</h2>${docs}</div>
    <div class="sign"><div>Surveyor signature</div><div>Verifying officer</div><div>Owner / occupant</div></div>
  </body></html>`;

  const win = window.open('', '_blank', 'width=1024,height=768');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 350);
  return true;
}
