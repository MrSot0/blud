// src/lib/inactividad.ts
// RF-T8: la sesión se cierra sola tras un tiempo sin actividad.
//   - Personal (operador, laboratorio, soporte, dirección): 15 minutos, porque maneja datos clínicos.
//   - Donante: 30 minutos.
// Un minuto antes aparece "¿Sigues ahí?" con cuenta atrás. La actividad de cualquier pestaña cuenta para todas
// (se comparte la hora de la última actividad), así que todas se cierran a la vez.

import { getSession, logout } from './auth';

const MINUTOS: Record<string, number> = { donante: 30, operador: 15, laboratorio: 15, soporte: 15, director: 15 };
const AVISO_MS = 60_000;
const CLAVE = 'blud-ultima-actividad'; // solo la hora; no son datos de la persona

const ahora = () => Date.now();
function ultima(): number {
  try { return Number(localStorage.getItem(CLAVE)) || ahora(); } catch { return ahora(); }
}
function marcar() {
  try { localStorage.setItem(CLAVE, String(ahora())); } catch {}
}

let dialogo: HTMLDialogElement | null = null;
function crearDialogo(): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.setAttribute('aria-labelledby', 'inact-t');
  d.style.cssText =
    'width:min(100% - 2rem,26rem);padding:0;margin:auto;border:1px solid var(--line);border-radius:1.5rem;' +
    'background:var(--surface);color:var(--ink);box-shadow:0 30px 60px -20px rgb(0 0 0/.45)';
  d.innerHTML = `
    <div style="padding:1.75rem;text-align:center;display:grid;gap:.75rem">
      <span style="margin:0 auto;display:grid;place-items:center;width:3.5rem;height:3.5rem;border-radius:9999px;background:var(--accent-soft);color:var(--accent-ink)" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </span>
      <h2 id="inact-t" style="font-size:1.25rem;font-weight:800">¿Sigues ahí?</h2>
      <p style="font-size:.875rem;color:var(--ink-2)">Por seguridad cerraremos tu sesión en <strong data-cuenta>60</strong> segundos si no hay actividad.</p>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:.75rem;margin-top:.5rem">
        <button type="button" class="btn btn-secondary" data-salir>Cerrar sesión</button>
        <button type="button" class="btn btn-primary" data-seguir>Seguir conectado</button>
      </div>
    </div>`;
  d.addEventListener('cancel', (e) => e.preventDefault()); // Esc no lo cierra sin decidir
  document.body.appendChild(d);
  return d;
}

let iniciado = false;

/** Empieza a vigilar la inactividad en las páginas del portal. */
export function iniciarCierrePorInactividad(): void {
  const s = getSession();
  if (iniciado || !s) return;
  iniciado = true;
  const limite = (MINUTOS[s.role] ?? 15) * 60_000;
  let ultimaMarca = 0;

  const actividad = () => {
    if (dialogo?.open) return; // con el aviso abierto, solo cuenta el botón "Seguir conectado"
    if (ahora() - ultimaMarca < 5_000) return; // no escribir en cada movimiento
    ultimaMarca = ahora();
    marcar();
  };
  ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach((ev) =>
    window.addEventListener(ev, actividad, { passive: true, capture: true }),
  );
  marcar();

  const salir = () => {
    try { localStorage.removeItem(CLAVE); } catch {}
    logout();
    location.replace(`/login?motivo=inactividad&next=${encodeURIComponent(location.pathname + location.search)}`);
  };

  const revisar = () => {
    if (!getSession()) return; // cerró sesión en otra pestaña
    const restante = limite - (ahora() - ultima());
    if (restante <= 0) return salir();
    if (restante <= AVISO_MS) {
      dialogo ??= crearDialogo();
      const n = dialogo.querySelector('[data-cuenta]');
      if (n) n.textContent = String(Math.ceil(restante / 1000));
      if (!dialogo.open) {
        dialogo.showModal();
        dialogo.querySelector<HTMLButtonElement>('[data-seguir]')!.onclick = () => { marcar(); dialogo!.close(); };
        dialogo.querySelector<HTMLButtonElement>('[data-salir]')!.onclick = salir;
        dialogo.querySelector<HTMLButtonElement>('[data-seguir]')!.focus();
      }
    } else if (dialogo?.open) {
      dialogo.close(); // hubo actividad en otra pestaña
    }
  };
  setInterval(revisar, 1_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisar(); });
}
