// ============================================================
// Central output safety.
//
// The app builds HTML strings with template literals. Anything that came from
// storage (Supabase rows, localStorage documents, imported payloads) must pass
// through these helpers before it is interpolated, otherwise a stored value
// containing markup becomes script in the page.
//
// Rules of thumb:
//   - text inside an element  -> escapeHtml(value)  (or set el.textContent)
//   - value inside "..."      -> escapeAttr(value)
//   - id / data-* identifier  -> safeId(value)
//   - CSS colour in style=""  -> safeColor(value, fallback)
//
// This is deliberately small. The app renders no rich HTML from user data, so
// a full sanitiser would add weight without adding protection.
// ============================================================

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/**
 * Escape a value for interpolation into HTML text or a quoted attribute.
 * Null/undefined become an empty string; everything else is stringified first.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`]/g, ch => HTML_ESCAPES[ch]);
}

/** Alias that documents intent at attribute call sites. */
export const escapeAttr = escapeHtml;

/**
 * Normalise a stored colour to something that cannot break out of a style
 * attribute. Accepts #rgb/#rrggbb/#rrggbbaa, rgb()/rgba(), hsl()/hsla(),
 * plain CSS keywords, and `var(--token)` references used across the app.
 * Anything else falls back to the supplied default.
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeColor(value, fallback = 'var(--accent)') {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 64) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
  if (/^(?:rgb|hsl)a?\(\s*[0-9a-z.,%\s/]+\)$/i.test(raw)) return raw;
  if (/^var\(--[a-z0-9-]+\)$/i.test(raw)) return raw;
  if (/^[a-z]{3,20}$/i.test(raw)) return raw; // CSS colour keyword
  return fallback;
}

/**
 * Normalise a stored identifier for use in an id/data-* attribute or a
 * querySelector. Keeps the characters real habit/activity/test ids use and
 * drops everything else, so an id can never terminate the attribute or inject
 * a selector.
 * @param {unknown} value
 * @returns {string}
 */
export function safeId(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 128);
}

/**
 * Replace an element's children with plain text. Preferred over innerHTML
 * whenever the content is a single untrusted string.
 * @param {Element|null} el
 * @param {unknown} value
 */
export function setText(el, value) {
  if (!el) return;
  el.textContent = value === null || value === undefined ? '' : String(value);
}
