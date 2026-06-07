// Small shared helpers for the School tabs.

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Copy text to the clipboard with a graceful fallback for non-secure contexts
// (older mobile webviews where navigator.clipboard is unavailable).
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

// Comma string → trimmed array (drops blanks and a literal "none").
export function parseTopics(str) {
  return String(str || '')
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(s => s && s.toLowerCase() !== 'none');
}
