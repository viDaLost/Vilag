import { $ } from './dom.js';

export function notify(text) {
  const root = $('#notifications');
  const el = document.createElement('div');
  el.className = 'notice';
  el.textContent = text;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
