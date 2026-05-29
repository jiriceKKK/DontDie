import { DAY_FULL } from '../constants.js';

export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function getMondayOfWeek(date) {
  const d = new Date(date);
  const dow = (d.getDay() + 6) % 7; // Mon=0, Sun=6
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

export function friendlyDay(date) {
  if (isSameDay(date, today())) return 'Today';
  if (isSameDay(date, addDays(today(), -1))) return 'Yesterday';
  return DAY_FULL[date.getDay()];
}
