import { formatDate, today, addDays } from '../../utils/date.js';
import { getTasks, addTask, toggleTask, deleteTask } from '../store.js';

let dayOffset = 0; // 0 = today, 1 = tomorrow

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderTasks() {
  const panel = document.getElementById('tab-tasks');
  if (!panel) return;
  const dateStr = formatDate(addDays(today(), dayOffset));
  const tasks = getTasks(dateStr);
  const pending = tasks.filter(t => !t.done);
  const done = tasks.filter(t => t.done);

  panel.innerHTML = `
    <div class="mh-header">
      <div class="mh-title">Tasks</div>
      <div class="mh-subtitle">Temporary, day-based — not habits</div>
    </div>

    <div class="pill-nav">
      <button class="pill-btn ${dayOffset === 0 ? 'active' : ''}" data-off="0">Today</button>
      <button class="pill-btn ${dayOffset === 1 ? 'active' : ''}" data-off="1">Tomorrow</button>
    </div>

    <form class="mh-add-row" id="mh-task-form">
      <input class="form-input" id="mh-task-input" type="text" maxlength="80" placeholder="Add a task…" autocomplete="off">
      <button class="btn btn-primary" type="submit" aria-label="Add">+</button>
    </form>

    ${tasks.length === 0 ? `<div class="mh-empty">No tasks for this day.</div>` : `
      <div class="mh-task-list">
        ${pending.map(taskRow).join('')}
        ${done.length ? `<div class="mh-task-divider">Done</div>` : ''}
        ${done.map(taskRow).join('')}
      </div>`}
  `;

  panel.querySelectorAll('.pill-btn').forEach(b => b.addEventListener('click', () => {
    dayOffset = parseInt(b.dataset.off); renderTasks();
  }));

  panel.querySelector('#mh-task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = panel.querySelector('#mh-task-input');
    const text = input.value.trim();
    if (!text) return;
    addTask(dateStr, text);
    renderTasks();
  });

  panel.querySelectorAll('[data-toggle]').forEach(el => el.addEventListener('click', () => { toggleTask(el.dataset.toggle); renderTasks(); }));
  panel.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(el.dataset.del); renderTasks(); }));
}

function taskRow(t) {
  return `
    <div class="mh-task ${t.done ? 'done' : ''}">
      <button class="mh-task-check" data-toggle="${t.id}" aria-label="Toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <div class="mh-task-text" data-toggle="${t.id}">${esc(t.text)}</div>
      <button class="mh-task-del" data-del="${t.id}" aria-label="Delete">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
}
