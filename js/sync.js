import { state } from './state.js';
import { dbUpsertLog } from './db.js';
import { showToast } from './ui/toast.js';

export function queueSync(dateStr, habitId, completed) {
  state.pendingQueue = state.pendingQueue.filter(
    o => !(o.date === dateStr && o.habitId === habitId)
  );
  state.pendingQueue.push({ date: dateStr, habitId, completed });
}

export async function flushQueue() {
  if (state.pendingQueue.length === 0) return;
  const queue  = [...state.pendingQueue];
  const failed = [];

  for (const op of queue) {
    const { error } = await dbUpsertLog(op.date, op.habitId, op.completed);
    if (error) failed.push(op);
  }

  state.pendingQueue = failed;
  if (failed.length === 0 && !state.isOnline) setOnline(true);
}

export function setOnline(online) {
  state.isOnline = online;
  const banner = document.getElementById('offline-banner');
  if (online) {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
  }
}

export function startRetryInterval() {
  if (state.retryInterval) return;
  state.retryInterval = setInterval(async () => {
    if (state.pendingQueue.length > 0) await flushQueue();
  }, 30000);
}
