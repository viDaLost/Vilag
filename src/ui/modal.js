import { $, $$ } from './dom.js';

export function setupModal() {
  $('#modal-close').onclick = closeModal;
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
}

export function closeModal() {
  $('#modal-overlay').classList.add('hidden');
}
