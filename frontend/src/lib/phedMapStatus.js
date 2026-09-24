export const phedState = (p) => p.phed_survey_state || p.phed_survey_status || 'Not Started';
export const phedMapColor = (state) => {
  if (['Approved', 'No PHED Connection'].includes(state)) return '#22c55e';
  if (['Draft', 'In Progress', 'Completed', 'Submitted', 'Requires Review', 'Document Pending'].includes(state)) return '#eab308';
  return '#ef4444';
};