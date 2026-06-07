// Backup export — raw, complete, machine-readable JSON of all module data.
// Always "all time". No config secrets / PIN / auth are ever included.

import { collectAll, rangeBounds, APP_VERSION, EXPORT_VERSION } from './collect.js';

export function buildBackup() {
  const b = rangeBounds('all');
  const data = collectAll(b);
  return JSON.stringify({
    exportType: 'backup',
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: 'DontDie', version: APP_VERSION },
    dateRange: 'all',
    physical: data.physical,
    mental: data.mental,
    stimulation: data.stimulation,
    school: data.school,
    metadata: { notes: 'Raw backup export. Not intended as medical or diagnostic data.' },
  }, null, 2);
}
