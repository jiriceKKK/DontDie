export function openModal(html, title = '') {
  const overlay = document.getElementById('modal-overlay');
  const wrapper = document.getElementById('modal-wrapper');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${title}</span>
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
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-wrapper').classList.add('hidden');
}
