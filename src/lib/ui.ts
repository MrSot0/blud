// src/lib/ui.ts
// Helpers de interfaz y formato compartidos por todos los módulos (donante, operador, director).

export const uid = () => Math.random().toString(36).slice(2, 10);

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const localISO = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const hoyISO = () => localISO(new Date());

export function sumarDias(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return localISO(d);
}

export const diasDesde = (iso: string) =>
  Math.floor((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 86400000);

export function fmtFecha(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-VE', opts);
}

export function downloadFile(name: string, content: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV seguro para Excel (BOM + comillas dobles escapadas) */
export function toCSV(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '\ufeff' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
}

let toastTimer: number | undefined;
export function toast(msg: string) {
  let el = document.getElementById('blud-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'blud-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText =
      'position:fixed;left:50%;bottom:1.5rem;z-index:80;max-width:calc(100vw - 2rem);padding:.75rem 1.25rem;border-radius:9999px;' +
      'background:var(--ink);color:var(--surface);font-size:.875rem;font-weight:600;pointer-events:none;' +
      'box-shadow:0 12px 30px -10px rgb(0 0 0/.5);transition:transform 300ms ease,opacity 300ms ease;' +
      'transform:translate(-50%,20px);opacity:0';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => {
    el!.style.transform = 'translate(-50%,0)';
    el!.style.opacity = '1';
  });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el!.style.transform = 'translate(-50%,20px)';
    el!.style.opacity = '0';
  }, 3200);
}
