// ============================================================
// MIND · TEXTS PROMPTS — the copy-to-clipboard generation prompt (an English
// instruction for the external AI) and the DONTDIE_TEXTS_FEEDBACK_V1 export
// that carries reading results back into that same conversation.
//
// No AI is ever called from the app. These are just strings the user pastes.
// ============================================================

import { getMindTexts, completedTexts } from './store.js';

// ---- generation prompt ----------------------------------------------------
// English on purpose (it instructs the AI), but it tells the AI to WRITE the
// texts — and continue the conversation — in whatever language is already in
// use. Schema keys / enum values stay English.

export const GENERATION_PROMPT = `You are generating a batch of educational reading texts for my personal reading app (DontDie · Mind · Texts).

LANGUAGE
- Write all five texts in the SAME language we are already using in this conversation. If we are speaking Czech, write the texts in Czech (and keep replying to me in Czech afterwards). Do not switch to English for the texts.
- Use English ONLY for the structured schema keys and enum values (version, texts, title, topic, style, length_class, paragraphs, etc.). All human-readable content — titles and paragraphs — is in the conversation's language.
- Any normal conversational reply you write before or after the block should also stay in that language.

WHAT TO GENERATE
- Exactly FIVE texts.
- Length mix (do not order them shortest → longest; shuffle the order so the progression is not obvious):
  - 2 short texts: ~350–550 words
  - 2 medium texts: ~650–900 words
  - 1 longer text: ~1000–1400 words
- Choose the topics yourself, adaptively. Use a varied mix — e.g. psychology, behaviour, neuroscience, health, perception, decision-making, science, history, technology, economics, biology, social behaviour, and other genuinely useful subjects. Do NOT produce five near-identical psychology texts.
- Use any preferences and feedback already present earlier in this conversation. Avoid repeating ideas we recently covered.

QUALITY BAR (each text)
- One coherent central idea, a strong opening, logical explanation, and concrete examples.
- Enough depth to actually teach something. Prefer concepts a person can understand and apply.
- Avoid: generic motivational self-help, filler, clickbait, invented studies or fake source attributions. Where something is uncertain, say so. Explain technical ideas clearly without dumbing them down.
- No generic conclusion like "the key is balance". No reflection questions inside the body. No markdown tables. No source list unless genuinely necessary.
- Plain paragraphs only (the app stores paragraphs as plain text).

OUTPUT FORMAT
Return ONLY the import block below — no surrounding commentary, and NO markdown code fences. Start the reply with the marker line exactly:

DONTDIE_TEXTS_IMPORT_V1
{
  "version": 1,
  "language": "cs",
  "generated_at": "<ISO 8601 timestamp>",
  "texts": [
    {
      "external_id": "batch-text-1",
      "title": "<title in the conversation language>",
      "topic": "<one lowercase english topic word, e.g. psychology>",
      "style": "explanatory",
      "length_class": "short",
      "paragraphs": [
        "<first paragraph>",
        "<second paragraph>"
      ]
    }
  ]
}

Set "language" to the language you actually wrote in (e.g. "cs" for Czech, "en" for English). Give each text a real title and 3+ substantial paragraphs. After the block, you may continue our conversation normally in that same language.`;

// ---- feedback export (DONTDIE_TEXTS_FEEDBACK_V1) --------------------------

const FEEDBACK_PREAMBLE = `Here are my reading results from the texts you generated (DontDie · Mind · Texts). Use them to adapt future batches:
- Do not overfit to any single rating — look for patterns across topic, style, length, difficulty, engagement and learning.
- Prefer more of what scored well on engagement AND learning; ease off what I rated low or marked "no more like this".
- Keep continuing our conversation in the language we are already using, and generate future texts in that same language. Keep the technical schema keys in English.
When you're ready, generate the next batch as a DONTDIE_TEXTS_IMPORT_V1 block.`;

const r1 = n => (n == null ? null : Math.round(n * 10) / 10);
const avg = arr => { const v = arr.filter(x => Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

function pickScope(scope) {
  const d = getMindTexts();
  let done = completedTexts();
  if (scope === 'batch') {
    const batches = [...(d.batches || [])].sort((a, b) => (b.importedAt || '').localeCompare(a.importedAt || ''));
    const bid = batches.length ? batches[0].id : null;
    done = done.filter(t => t.batchId === bid);
  } else if (scope === 'unexported') {
    const since = d.lastFeedbackExportAt;
    if (since) done = done.filter(t => (t.completedAt || '') > since);
  }
  // 'all' → everything completed
  return done.sort((a, b) => (a.completedAt || '').localeCompare(b.completedAt || ''));
}

// Returns { count, text }. Text is safe to paste even when count is 0 (it just
// reports there is nothing new), but the UI disables the action in that case.
export function buildFeedback(scope = 'unexported') {
  const done = pickScope(scope);
  const summary = {
    texts_completed: done.length,
    words_read: done.reduce((n, t) => n + (t.wordCount || 0), 0),
    reading_seconds: done.reduce((n, t) => n + Math.round(t.readingSeconds || 0), 0),
    average_engagement: r1(avg(done.map(t => t.reflection && t.reflection.engagement))),
    average_learning: r1(avg(done.map(t => t.reflection && t.reflection.learning))),
    average_relevance: r1(avg(done.map(t => t.reflection && t.reflection.relevance))),
  };
  const texts = done.map(t => {
    const r = t.reflection || {};
    return {
      title: t.title,
      topic: t.topic,
      style: t.style,
      length_class: t.lengthClass,
      word_count: t.wordCount || 0,
      reading_seconds: Math.round(t.readingSeconds || 0),
      reflection: {
        engagement: r.engagement ?? null,
        learning: r.learning ?? null,
        relevance: r.relevance ?? null,
        difficulty: r.difficulty ?? null,
        length_fit: r.length_fit ?? null,
        more_like_this: r.more_like_this ?? null,
        note: (r.note || '').trim() || null,
      },
      highlights: (t.highlights || []).map(h => h.quote).filter(Boolean),
    };
  });
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    scope,
    summary,
    texts,
  };
  const text = `${FEEDBACK_PREAMBLE}\n\nDONTDIE_TEXTS_FEEDBACK_V1\n${JSON.stringify(payload, null, 2)}`;
  return { count: done.length, text };
}

export const FEEDBACK_SCOPES = [
  { id: 'unexported', label: 'New since last export', hint: 'Completed texts not yet sent' },
  { id: 'batch', label: 'Current batch', hint: 'Most recent import only' },
  { id: 'all', label: 'All completed', hint: 'Every completed text' },
];
