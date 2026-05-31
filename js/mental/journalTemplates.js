// Guided journal templates. Each field: { key, label, type, placeholder? }.
// type: 'text' (one line) | 'area' (multi-line). Kept practical, not clinical.

export const JOURNAL_TEMPLATES = [
  {
    id: 'reflection',
    name: 'Quick daily reflection',
    blurb: 'Three quick lines about today.',
    fields: [
      { key: 'went_ok', label: 'What went okay', type: 'text', placeholder: 'one thing' },
      { key: 'was_hard', label: 'What was hard', type: 'text', placeholder: 'one thing' },
      { key: 'note', label: 'Anything else', type: 'area', placeholder: 'optional' },
    ],
  },
  {
    id: 'thought_record',
    name: 'Thought record (CBT)',
    blurb: 'Work through one specific thought.',
    fields: [
      { key: 'situation', label: 'Situation', type: 'text', placeholder: 'what happened' },
      { key: 'feeling', label: 'Feeling', type: 'text', placeholder: 'and how strong (0–100%)' },
      { key: 'auto_thought', label: 'Automatic thought', type: 'area', placeholder: 'what went through your head' },
      { key: 'evidence_for', label: 'Evidence for', type: 'area' },
      { key: 'evidence_against', label: 'Evidence against', type: 'area' },
      { key: 'realistic', label: 'More realistic thought', type: 'area' },
      { key: 'feeling_after', label: 'Feeling after', type: 'text', placeholder: 'and how strong now' },
    ],
  },
  {
    id: 'stress_dump',
    name: 'Stress dump',
    blurb: 'Get everything out of your head.',
    fields: [
      { key: 'dump', label: 'On my mind', type: 'area', placeholder: 'write it all out, no filter' },
    ],
  },
  {
    id: 'trigger_log',
    name: 'Trigger log',
    blurb: 'Note what set something off.',
    fields: [
      { key: 'trigger', label: 'Trigger', type: 'text', placeholder: 'what happened' },
      { key: 'reaction', label: 'Reaction', type: 'area', placeholder: 'what you felt / did' },
      { key: 'intensity', label: 'Intensity (1–5)', type: 'text', placeholder: '1–5' },
    ],
  },
  {
    id: 'helped_worse',
    name: 'What helped / what made it worse',
    blurb: 'Sort today into two lists.',
    fields: [
      { key: 'helped', label: 'What helped', type: 'area' },
      { key: 'worse', label: 'What made it worse', type: 'area' },
    ],
  },
  {
    id: 'tomorrow_reset',
    name: 'Tomorrow reset',
    blurb: 'Set up a clean start.',
    fields: [
      { key: 'top', label: 'Top 1–3 for tomorrow', type: 'area' },
      { key: 'let_go', label: 'What to let go of', type: 'text' },
      { key: 'win', label: 'One small win to aim for', type: 'text' },
    ],
  },
];

export function getTemplate(id) {
  return JOURNAL_TEMPLATES.find(t => t.id === id) || null;
}
