import { getDayStats } from '../habits.js';

export function updateProgressRing(date) {
  const { total, completed } = getDayStats(date);
  const ring  = document.getElementById('progress-ring-fill');
  const label = document.getElementById('progress-ring-text');
  if (!ring || !label) return;

  const r            = 20;
  const circumference = 2 * Math.PI * r;
  const pct          = total > 0 ? completed / total : 0;
  ring.style.strokeDasharray  = circumference;
  ring.style.strokeDashoffset = circumference * (1 - pct);
  label.textContent = `${completed}/${total}`;
}
