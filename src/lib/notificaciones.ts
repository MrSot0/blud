// src/lib/notificaciones.ts
// Notificaciones de mensajes nuevos del chat, en todas las páginas del portal (donante, operador y soporte).
// Escucha el buzón en tiempo real (Supabase Realtime, el mismo WebSocket del chat) y, cuando llega un mensaje
// del otro lado:
//   - pone el contador de no leídos en "Mensajes" del menú lateral, un punto en el botón del menú y (N) en el título;
//   - muestra un aviso en la página con el remitente y el inicio del mensaje, y un enlace para abrirlo;
//   - si la pestaña no está a la vista y el usuario dio permiso, muestra una notificación del sistema.
// No guarda nada en el navegador: los no leídos los cuenta la base (blud_chat_conversaciones).

import { getSession } from './auth';
import { canalBuzon, chatDisponible, escuchar, listarConversaciones, type Conversacion } from './chat';

const ROLES_CON_MENSAJES = ['donante', 'operador', 'soporte'];
const TITULO_BASE = document.title.replace(/^\(\d+\)\s*/, '');

/** Ruta de Mensajes del rol, o null si el rol no tiene chat. */
function rutaMensajes(): string | null {
  const r = getSession()?.role;
  return r && ROLES_CON_MENSAJES.includes(r) ? `/${r}/mensajes` : null;
}

// ------------------------------------------------------------------ Permiso del navegador
export const notificacionesSoportadas = () => typeof window !== 'undefined' && 'Notification' in window;
export const permisoNotificaciones = (): NotificationPermission | 'no-soportado' =>
  notificacionesSoportadas() ? Notification.permission : 'no-soportado';

/** Pide permiso para mostrar notificaciones del sistema. Debe llamarse desde un clic del usuario. */
export async function pedirPermisoNotificaciones(): Promise<NotificationPermission | 'no-soportado'> {
  if (!notificacionesSoportadas()) return 'no-soportado';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

// ------------------------------------------------------------------ Indicadores
function pintarContador(n: number) {
  const ruta = rutaMensajes();
  if (ruta) {
    document.querySelectorAll<HTMLElement>(`[data-menu="${ruta}"]`).forEach((link) => {
      const badge = link.querySelector<HTMLElement>('[data-menu-badge]');
      if (!badge) return;
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.classList.toggle('hidden', !n);
      badge.classList.toggle('grid', !!n);
      badge.setAttribute('aria-label', `${n} sin leer`);
    });
  }
  document.querySelectorAll<HTMLElement>('[data-avisos-punto]').forEach((p) => p.classList.toggle('hidden', !n));
  document.title = n ? `(${n}) ${TITULO_BASE}` : TITULO_BASE;
  window.dispatchEvent(new CustomEvent('blud:mensajes', { detail: { noLeidos: n } }));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Aviso dentro de la página (abajo a la derecha), con enlace a la conversación. */
function avisoEnPagina(titulo: string, texto: string, href: string) {
  let pila = document.getElementById('blud-avisos');
  if (!pila) {
    pila = document.createElement('div');
    pila.id = 'blud-avisos';
    pila.setAttribute('role', 'status');
    pila.setAttribute('aria-live', 'polite');
    pila.style.cssText = 'position:fixed;right:1rem;bottom:1rem;z-index:85;display:grid;gap:.5rem;width:min(22rem,calc(100vw - 2rem))';
    document.body.appendChild(pila);
  }
  const card = document.createElement('div');
  card.style.cssText =
    'display:flex;gap:.75rem;align-items:flex-start;padding:.85rem 1rem;border-radius:1rem;background:var(--surface);color:var(--ink);' +
    'border:1px solid var(--line);box-shadow:0 18px 40px -16px rgb(0 0 0/.45);transform:translateY(12px);opacity:0;transition:transform 250ms ease,opacity 250ms ease';
  card.innerHTML = `
    <span style="display:grid;place-items:center;flex-shrink:0;width:2.25rem;height:2.25rem;border-radius:9999px;background:var(--accent-soft);color:var(--accent-ink)" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
    </span>
    <span style="min-width:0;flex:1">
      <strong style="display:block;font-size:.875rem">${esc(titulo)}</strong>
      <span style="display:block;font-size:.8125rem;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(texto)}</span>
      <a href="${esc(href)}" style="display:inline-block;margin-top:.35rem;font-size:.8125rem;font-weight:700;color:var(--accent-ink)">Abrir conversación</a>
    </span>
    <button type="button" aria-label="Cerrar aviso" style="flex-shrink:0;color:var(--ink-3);cursor:pointer;padding:.15rem">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>`;
  const cerrar = () => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(12px)';
    setTimeout(() => card.remove(), 260);
  };
  card.querySelector('button')!.addEventListener('click', cerrar);
  pila.appendChild(card);
  requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = 'none'; });
  setTimeout(cerrar, 8000);
  while (pila.children.length > 3) pila.firstElementChild?.remove();
}

/** Notificación del sistema (solo si la pestaña no está a la vista y hay permiso). */
function notificacionSistema(titulo: string, texto: string, href: string, etiqueta: string) {
  if (permisoNotificaciones() !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(titulo, { body: texto, tag: etiqueta, icon: '/favicon.svg', badge: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      location.href = href;
      n.close();
    };
  } catch {
    // Algunos navegadores móviles solo permiten notificaciones desde un service worker.
  }
}

// ------------------------------------------------------------------ Arranque
let iniciado = false;

/** Empieza a escuchar mensajes nuevos. Se llama una vez por página del portal. */
export async function iniciarAvisosMensajes(): Promise<void> {
  const ruta = rutaMensajes();
  if (iniciado || !ruta || !chatDisponible()) return;
  iniciado = true;
  const personal = getSession()?.role !== 'donante';
  const yo = personal ? 'personal' : 'donante';

  let donanteId: string | undefined;
  if (!personal) {
    const { cargarFicha } = await import('./donante');
    donanteId = (await cargarFicha()).id;
  }
  const canal = canalBuzon(donanteId);
  if (!canal) return;

  // Último mensaje conocido de cada conversación, para avisar solo de lo nuevo.
  const conocidos = new Map<string, string>();
  const enEsaConversacion = (c: Conversacion) =>
    location.pathname === ruta && new URLSearchParams(location.search).get('c') === c.id && document.visibilityState === 'visible';

  async function revisar(avisar: boolean) {
    let lista: Conversacion[];
    try { lista = await listarConversaciones(); } catch { return; }
    pintarContador(lista.reduce((n, c) => n + (c.noLeidos ?? 0), 0));
    for (const c of lista) {
      const ultimo = c.ultimo?.creado ?? '';
      const antes = conocidos.get(c.id);
      conocidos.set(c.id, ultimo);
      if (!avisar || !c.ultimo || ultimo === antes || c.ultimo.autorTipo === yo || !c.noLeidos || enEsaConversacion(c)) continue;
      const titulo = personal ? `${c.donante?.nombre ?? 'Donante'} te escribió` : 'Nuevo mensaje del banco de sangre';
      const href = `${ruta}?c=${encodeURIComponent(c.id)}`;
      // En la página de Mensajes la lista ya se actualiza sola; el aviso flotante sobra.
      if (location.pathname !== ruta) avisoEnPagina(titulo, c.ultimo.texto, href);
      notificacionSistema(titulo, c.ultimo.texto, href, c.id);
    }
  }

  await revisar(false);
  escuchar(canal, { alNovedad: () => revisar(true) });
  // Al volver a la pestaña o leer una conversación, el contador se pone al día.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisar(false); });
  window.addEventListener('blud:chat-leido', () => revisar(false));
}
