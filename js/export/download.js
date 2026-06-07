// Browser file download via Blob + object URL, with an iOS fallback that opens
// the file in a new tab when the download attribute is ignored.

export function downloadFile(filename, text, mime = 'text/plain') {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    // Fallback (older iOS Safari / PWA): open in a new tab so it can be saved.
    try {
      const blob = new Blob([text], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      return true;
    } catch {
      return false;
    }
  }
}
