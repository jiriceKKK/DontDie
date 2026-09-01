import { escapeHtml } from './dom.js';

// _closing tracks an in-flight exit animation so overlay-click + close-button
// can't stack. _gen is bumped on every open so a close that is superseded by a
// new open (e.g. past-day picker → day-log modal) never hides the new modal.
let _closing = false;
let _gen = 0;

export function openModal(html, title = '') {
  const overlay = document.getElementById('modal-overlay');
  const wrapper = document.getElementById('modal-wrapper');
  const box     = document.getElementById('modal-box');
  const content = document.getElementById('modal-content');

  _gen++;                 // invalidate any pending close from a previous modal
  _closing = false;
  overlay.classList.remove('closing');
  box.classList.remove('closing');

  content.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${escapeHtml(title)}</span>
      <button class="modal-close" id="modal-close-btn" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="modal-body">${html}</div>
  `;

  overlay.classList.remove('hidden');
  wrapper.classList.remove('hidden');

  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', closeModal, { once: true });
}

export function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  const wrapper = document.getElementById('modal-wrapper');
  const box     = document.getElementById('modal-box');
  if (!overlay || overlay.classList.contains('hidden') || _closing) return;
  _closing = true;
  const myGen = _gen;

  const hide = () => {
    overlay.classList.add('hidden');
    wrapper.classList.add('hidden');
    overlay.classList.remove('closing');
    box.classList.remove('closing');
    _closing = false;
  };

  // Reduced motion: skip the exit animation entirely.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { hide(); return; }

  overlay.classList.add('closing');
  box.classList.add('closing');

  let done = false;
  const finish = (e) => {
    // Ignore animationend bubbling up from child elements (e.g. a check pulse).
    if (e && e.target !== box) return;
    if (done) return;
    box.removeEventListener('animationend', finish);
    done = true;
    // A newer openModal superseded this close — leave the new modal alone.
    if (myGen !== _gen) return;
    hide();
  };
  box.addEventListener('animationend', finish);
  setTimeout(finish, 280); // fallback if animationend never fires
}
