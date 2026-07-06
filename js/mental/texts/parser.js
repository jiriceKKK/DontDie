// ============================================================
// MIND · TEXTS PARSER — turns a pasted DONTDIE_TEXTS_IMPORT_V1 block into
// validated text candidates, and provides the deterministic tokenizer used
// everywhere text is rendered (reader, highlights, viewer).
//
// Safety: the app computes its own word counts, its own content fingerprint
// and its own ids — an AI-provided count / id is never trusted. Imported
// bodies are plain text; nothing here (or downstream) treats them as HTML.
// ============================================================

const MARKER = 'DONTDIE_TEXTS_IMPORT_V1';
const LENGTHS = ['short', 'medium', 'long'];

// ---- word count (Unicode-aware; handles Czech diacritics) -----------------

export function countWords(paragraphs) {
  let n = 0;
  for (const p of (paragraphs || [])) {
    const m = String(p == null ? '' : p).match(/[\p{L}\p{N}]+/gu);
    if (m) n += m.length;
  }
  return n;
}

function classifyLength(wc) {
  if (wc <= 550) return 'short';
  if (wc <= 900) return 'medium';
  return 'long';
}

// ---- stable content fingerprint (normalized title + body) -----------------
// Deterministic FNV-1a over lowercased, whitespace-collapsed content, so the
// same batch imported twice produces the same hash → duplicate detection that
// does not rely on the AI's external_id.

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

export function contentFingerprint(title, paragraphs) {
  const norm = (String(title || '') + '\n' + (paragraphs || []).join('\n'))
    .toLowerCase().replace(/\s+/g, ' ').trim();
  return fnv1a(norm);
}

// ---- import block extraction ----------------------------------------------
// Finds the marker even when the AI adds prose before/after, then walks a
// balanced-brace scan (string-aware) to pull out exactly the JSON object.

function extractJsonBlock(raw) {
  const s = String(raw || '');
  const mi = s.indexOf(MARKER);
  if (mi === -1) return { error: `No ${MARKER} block found. Paste the whole block the AI produced.` };
  let i = s.indexOf('{', mi + MARKER.length);
  if (i === -1) return { error: `Found the ${MARKER} marker but no JSON object after it.` };
  const start = i;
  let depth = 0, inStr = false, esc = false;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return { json: s.slice(start, i + 1) }; }
  }
  return { error: 'The import JSON looks incomplete (unbalanced braces). Copy the entire block, including the final }.' };
}

function normalizeCandidate(rawT) {
  if (!rawT || typeof rawT !== 'object') return null;
  const title = String(rawT.title == null ? '' : rawT.title).replace(/\s+/g, ' ').trim();
  let paras = Array.isArray(rawT.paragraphs) ? rawT.paragraphs
            : (typeof rawT.body === 'string' ? rawT.body.split(/\n{2,}/) : []);
  paras = paras.map(p => String(p == null ? '' : p).replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!title || !paras.length) return null;
  const wordCount = countWords(paras);
  const rawLen = String(rawT.length_class || rawT.lengthClass || '').toLowerCase();
  const lengthClass = LENGTHS.includes(rawLen) ? rawLen : classifyLength(wordCount);
  const topic = (String(rawT.topic || 'general').trim().toLowerCase() || 'general').slice(0, 48);
  const style = (String(rawT.style || 'explanatory').trim().toLowerCase() || 'explanatory').slice(0, 32);
  return {
    title: title.slice(0, 200),
    topic, style, lengthClass,
    paragraphs: paras,
    wordCount,
    contentHash: contentFingerprint(title, paras),
    externalId: rawT.external_id != null ? String(rawT.external_id).slice(0, 120) : null,
  };
}

// Public: parse + validate. Returns { ok, error, warnings, language,
// generatedAt, texts } — NO fallback to a looser parser on failure.
export function parseTextsImport(raw) {
  const ex = extractJsonBlock(raw);
  if (ex.error) return { ok: false, error: ex.error, warnings: [] };

  let obj;
  try { obj = JSON.parse(ex.json); }
  catch (e) { return { ok: false, error: 'The import block is not valid JSON: ' + (e.message || 'parse error') + '.', warnings: [] }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'The import block did not contain a JSON object.', warnings: [] };
  }

  const warnings = [];
  if (obj.version != null && Number(obj.version) !== 1) {
    return { ok: false, error: `Unsupported import version "${obj.version}". This app reads version 1.`, warnings: [] };
  }
  if (obj.version == null) warnings.push('Import had no version field — assuming version 1.');

  if (!Array.isArray(obj.texts) || obj.texts.length === 0) {
    return { ok: false, error: 'The import block has no "texts" array, or it is empty.', warnings: [] };
  }

  const candidates = [];
  let dropped = 0;
  for (const rawT of obj.texts) {
    const c = normalizeCandidate(rawT);
    if (c) candidates.push(c); else dropped++;
  }
  if (!candidates.length) return { ok: false, error: 'None of the texts had both a title and a non-empty body.', warnings: [] };
  if (dropped) warnings.push(`${dropped} text${dropped > 1 ? 's were' : ' was'} skipped (missing title or empty body).`);
  if (candidates.length !== 5) warnings.push(`Expected 5 texts but got ${candidates.length} — imported the valid ones.`);

  return {
    ok: true, error: null, warnings,
    language: typeof obj.language === 'string' ? obj.language : null,
    generatedAt: typeof obj.generated_at === 'string' ? obj.generated_at : null,
    texts: candidates,
  };
}

// ---- deterministic tokenizer ----------------------------------------------
// The SAME tokenization runs on every render, so stored highlight coordinates
// (paragraph / sentence / word indices) stay valid regardless of layout,
// font size, or device. Czech punctuation and diacritics are handled.

const SENTENCE_END = { '.': 1, '!': 1, '?': 1, '…': 1 }; // . ! ? …
const CLOSERS = /["'”’»)\]]/;                   // " ' ” ’ » ) ]

export function splitSentences(paragraph) {
  const s = String(paragraph || '');
  const out = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    buf += ch;
    if (SENTENCE_END[ch]) {
      // absorb trailing closing quotes / brackets into this sentence
      let j = i + 1;
      while (j < s.length && CLOSERS.test(s[j])) { buf += s[j]; j++; }
      i = j - 1;
      // a boundary only if the next non-consumed char is whitespace or the end
      if (j >= s.length || /\s/.test(s[j])) {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
      }
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out.length ? out : (s.trim() ? [s.trim()] : []);
}

export function splitWords(sentence) {
  return String(sentence || '').split(/\s+/).filter(Boolean);
}

// paragraphs → [{ text, sentences:[{ text, words:[string] }] }]
export function tokenizeText(paragraphs) {
  return (paragraphs || []).map(p => ({
    text: p,
    sentences: splitSentences(p).map(st => ({ text: st, words: splitWords(st) })),
  }));
}

// Flat, reading-order list of every sentence with its coordinates — used by
// the Highlights viewer to build a context window across paragraph borders.
export function flattenSentences(paragraphs) {
  const flat = [];
  const toks = tokenizeText(paragraphs);
  toks.forEach((para, p) => para.sentences.forEach((sent, s) => flat.push({ p, s, text: sent.text, words: sent.words })));
  return flat;
}
