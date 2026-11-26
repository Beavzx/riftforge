// Light/dark theme via the root data-theme attribute.
import { h, store } from './dom';

export function applyTheme(t: 'dark' | 'light' | '') {
  const prefersLight = (() => { try { return matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; } })();
  document.documentElement.dataset.theme = t || (prefersLight ? 'light' : 'dark');
}
export function themeToggle(small = true): HTMLElement {
  const label = () => document.documentElement.dataset.theme === 'light' ? '☾' + (small ? '' : ' Dark') : '☀' + (small ? '' : ' Light');
  const b = h('button', { class: 'btn small ghost', 'aria-label': 'Toggle light/dark theme', title: 'Toggle theme', 'data-testid': 'theme' }, label());
  b.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next; store.set('riftforge.theme', next);
    b.textContent = label();
  });
  return b;
}
