import { $ } from './dom.js';

export function setupModal() {
  $('#modal-close').onclick = closeModal;
  $('#modal-overlay').addEventListener('pointerdown', (e) => {
    if (e.target === $('#modal-overlay')) closeModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
}

export function openModal(title, subtitle, html, actions = []) {
  $('#modal-title').textContent = title;
  $('#modal-subtitle').textContent = subtitle;
  $('#modal-body').innerHTML = html;
  $('#modal-actions').innerHTML = actions.map((a, i) => `<button class="${a.primary ? 'primary-btn' : 'secondary-btn'}" data-modal-action="${i}">${a.label}</button>`).join('');
  $('#modal-overlay').classList.remove('hidden');
  actions.forEach((a, i) => {
    document.querySelector(`[data-modal-action="${i}"]`)?.addEventListener('click', () => a.onClick?.());
  });
  document.querySelector('[data-modal-action="0"]')?.focus();
}

export function closeModal() {
  $('#modal-overlay').classList.add('hidden');
}
