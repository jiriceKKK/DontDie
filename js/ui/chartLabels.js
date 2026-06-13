// Small shared helper: weekday-letter + day-number labels under daily bar
// charts. Thins labels to ~7 max so they never overlap on mobile, and always
// labels the last (most recent) bar. `dates` is an array of 'YYYY-MM-DD' (or
// nullish) aligned to the bars; the chart passes its width W and bar count n.

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function barDayLabels(dates, { W, n, y }) {
  const out = [];
  const step = Math.max(1, Math.ceil(n / 7));
  for (let i = 0; i < dates.length; i++) {
    if (i % step !== 0 && i !== n - 1) continue;
    const ds = dates[i];
    const d = ds ? new Date(ds + 'T00:00:00') : null;
    if (!d || isNaN(d.getTime())) continue;
    const x = i * (W / n) + (W / n) / 2;
    out.push(`<text x="${x}" y="${y}" text-anchor="middle" font-size="8" fill="var(--text-muted)" font-family="'DM Mono',monospace">${DOW[d.getDay()]}</text>`);
    out.push(`<text x="${x}" y="${y + 9}" text-anchor="middle" font-size="8" fill="var(--text-muted)" font-family="'DM Mono',monospace">${d.getDate()}</text>`);
  }
  return out.join('');
}
