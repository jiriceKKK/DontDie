import { openModal, closeModal } from '../../ui/modal.js';
import { showToast } from '../../ui/toast.js';
import { addTask } from '../store.js';
import { formatDate, today } from '../../utils/date.js';

const TOOLS = [
  { id: 'breathing', name: 'Breathing timer',   blurb: 'Box breathing, 4·4·4·4' },
  { id: 'grounding', name: 'Grounding 5-4-3-2-1', blurb: 'Anchor to your senses' },
  { id: 'reset',     name: 'Quick reset',        blurb: 'A short physical checklist' },
  { id: 'control',   name: 'What can I control?', blurb: 'Sort it into two lists' },
  { id: 'decompress',name: 'Decompress',         blurb: 'Brain dump → one next action' },
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderTools() {
  const panel = document.getElementById('tab-tools');
  if (!panel) return;
  panel.innerHTML = `
    <div class="mh-header">
      <div class="mh-title">Tools</div>
      <div class="mh-subtitle">Quick, practical, offline</div>
    </div>
    <div class="mh-tool-grid">
      ${TOOLS.map(t => `
        <button class="mh-tool" data-tool="${t.id}">
          <div class="mh-tool-name">${esc(t.name)}</div>
          <div class="mh-tool-blurb">${esc(t.blurb)}</div>
        </button>`).join('')}
    </div>`;
  panel.querySelectorAll('.mh-tool').forEach(b => b.addEventListener('click', () => openTool(b.dataset.tool)));
}

function openTool(id) {
  if (id === 'breathing') return openBreathing();
  if (id === 'grounding') return openGrounding();
  if (id === 'reset') return openReset();
  if (id === 'control') return openControl();
  if (id === 'decompress') return openDecompress();
}

// ── Breathing timer ───────────────────────────────────────────────────────
let breathTimer = null;
function stopBreath() { if (breathTimer) { clearInterval(breathTimer); breathTimer = null; } }

function openBreathing() {
  openModal(`
    <div class="breath-wrap">
      <div class="breath-circle" id="breath-circle">
        <div class="breath-count" id="breath-count">4</div>
      </div>
      <div class="breath-label" id="breath-label">Get ready…</div>
      <button class="btn btn-primary" id="breath-toggle" style="width:100%;margin-top:18px;">Start</button>
    </div>
  `, 'Breathing');
  stopBreath();
  const toggle = document.getElementById('breath-toggle');
  toggle.addEventListener('click', () => {
    if (breathTimer) { stopBreath(); toggle.textContent = 'Start'; document.getElementById('breath-label').textContent = 'Paused'; }
    else { startBreath(); toggle.textContent = 'Stop'; }
  });
}

function startBreath() {
  const phases = [['Breathe in', 4, 1], ['Hold', 4, null], ['Breathe out', 4, 0.55], ['Hold', 4, null]];
  let pi = 0, remaining = phases[0][1];
  const circle = document.getElementById('breath-circle');
  const label = document.getElementById('breath-label');
  const apply = () => {
    const [name, , scale] = phases[pi];
    label.textContent = name;
    if (scale != null) circle.style.transform = `scale(${scale})`;
    document.getElementById('breath-count').textContent = remaining;
  };
  apply();
  breathTimer = setInterval(() => {
    // Auto-stop if the modal was closed without pressing Stop.
    const overlay = document.getElementById('modal-overlay');
    if (!document.getElementById('breath-circle') || !overlay || overlay.classList.contains('hidden')) { stopBreath(); return; }
    remaining--;
    if (remaining <= 0) { pi = (pi + 1) % phases.length; remaining = phases[pi][1]; apply(); }
    else document.getElementById('breath-count').textContent = remaining;
  }, 1000);
}

// ── Grounding 5-4-3-2-1 ───────────────────────────────────────────────────
function openGrounding() {
  const steps = [
    { n: 5, s: 'things you can see' },
    { n: 4, s: 'things you can feel' },
    { n: 3, s: 'things you can hear' },
    { n: 2, s: 'things you can smell' },
    { n: 1, s: 'thing you can taste' },
  ];
  let i = 0;
  openModal('<div id="ground-body"></div>', 'Grounding');
  const body = document.getElementById('ground-body');
  const draw = () => {
    if (i >= steps.length) {
      body.innerHTML = `<div class="ground-step"><div class="ground-num">✓</div><div class="ground-text">Done. Notice how you feel now.</div></div>
        <button class="btn btn-primary" id="ground-next" style="width:100%;margin-top:18px;">Close</button>`;
      document.getElementById('ground-next').addEventListener('click', closeModal);
      return;
    }
    const st = steps[i];
    body.innerHTML = `
      <div class="ground-step"><div class="ground-num">${st.n}</div><div class="ground-text">${st.s}</div></div>
      <div class="ground-progress">${i + 1} / ${steps.length}</div>
      <button class="btn btn-primary" id="ground-next" style="width:100%;margin-top:18px;">${i === steps.length - 1 ? 'Finish' : 'Next'}</button>`;
    document.getElementById('ground-next').addEventListener('click', () => { i++; draw(); });
  };
  draw();
}

// ── Quick reset checklist ─────────────────────────────────────────────────
function openReset() {
  const items = ['Unclench your jaw', 'Drop your shoulders', 'Take 3 slow breaths', 'Drink some water', 'Look at something 20ft away', 'Stand up and stretch'];
  openModal(`<div class="reset-list">${items.map((t, i) => `
    <button class="reset-item" data-i="${i}">
      <span class="reset-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
      <span>${t}</span>
    </button>`).join('')}</div>`, 'Quick reset');
  document.querySelectorAll('.reset-item').forEach(b => b.addEventListener('click', () => b.classList.toggle('checked')));
}

// ── What can I control? ───────────────────────────────────────────────────
function openControl() {
  openModal(`
    <div class="form-group"><label class="form-label">Can control</label><textarea class="form-input mh-area" id="ctl-can" rows="4" placeholder="one per line"></textarea></div>
    <div class="form-group"><label class="form-label">Can't control</label><textarea class="form-input mh-area" id="ctl-cant" rows="4" placeholder="one per line"></textarea></div>
    <div class="mh-empty" style="text-align:left;">Spend your energy on the first list. This isn't saved.</div>
  `, "What can I control?");
}

// ── Decompress ────────────────────────────────────────────────────────────
function openDecompress() {
  openModal(`
    <div class="form-group"><label class="form-label">Brain dump</label><textarea class="form-input mh-area" id="dec-dump" rows="5" placeholder="everything on your mind"></textarea></div>
    <div class="form-group"><label class="form-label">One next action</label><input class="form-input" id="dec-action" type="text" placeholder="the single next step"></div>
    <button class="btn btn-primary" id="dec-add" style="width:100%;">Add next action to today's tasks</button>
    <div class="mh-empty" style="text-align:left;margin-top:8px;">Only the next action is saved (as a task). The dump isn't.</div>
  `, 'Decompress');
  document.getElementById('dec-add').addEventListener('click', () => {
    const v = (document.getElementById('dec-action').value || '').trim();
    if (!v) { showToast('Write a next action first', 'warning'); return; }
    addTask(formatDate(today()), v);
    closeModal();
    showToast('Added to today’s tasks', 'success');
  });
}
