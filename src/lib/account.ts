// src/lib/account.ts
// Una sola función rellena los datos de la cuenta en CUALQUIER navbar o menú lateral (público, donante, operador).
// Marcas que entiende en el HTML:
//   [data-user-initials] [data-user-first] [data-user-name] [data-user-email] [data-user-blood]
//   [data-next-appointment] [data-next-appointment-short]            (donante)
//   [data-op-centro] [data-op-pendientes] [data-op-verificar]        (operador)
//   [data-role-home]  → enlace al inicio de su zona (con [data-role-home-label] opcional)
//   [data-role-cta]   → botón principal según rol
//   [data-role-only="donante|operador|director"] → se muestra solo para ese rol (regla CSS en global.css)

import { appointmentLabel, getSession, initials, nextAppointment, sinTitulo } from './auth';
import { ROLE_HOME, ROLE_LABEL, roleOf } from './roles';
import type { Role } from './roles';
import { centroById, fmtFecha, getCita, loadDonor } from './donante';
import { getPedidosPorAprobar, kpis, operadorActual } from './operador';
import { kpisLab } from './laboratorio';
import { kpisSoporte } from './soporte';

const fill = (selector: string, value: string) =>
  document.querySelectorAll(selector).forEach((el) => (el.textContent = value));

const HOME_LABEL: Record<Role, string> = {
  donante: 'Mi perfil',
  operador: 'Ir al panel de operación',
  laboratorio: 'Ir al panel del laboratorio',
  soporte: 'Ir al panel de soporte',
  director: 'Ir al dashboard',
};
const CTA_LABEL: Record<Role, string> = {
  donante: 'Agendar una donación',
  operador: 'Ir al panel de operación',
  laboratorio: 'Ir al panel del laboratorio',
  soporte: 'Ir al panel de soporte',
  director: 'Ir al dashboard',
};

/** Devuelve false si no hay sesión. */
export function renderAccount(): boolean {
  const root = document.documentElement;
  const user = getSession();
  if (!user) {
    delete root.dataset.auth;
    delete root.dataset.role;
    return false;
  }

  const role = roleOf(user);
  root.dataset.auth = 'in';
  root.dataset.role = role;

  fill('[data-user-initials]', initials(user.name));
  fill('[data-user-first]', sinTitulo(user.name).split(/\s+/)[0] ?? '');
  fill('[data-user-name]', user.name);
  fill('[data-user-email]', user.email);

  document.querySelectorAll<HTMLAnchorElement>('[data-role-home]').forEach((a) => {
    a.href = ROLE_HOME[role];
    const label = a.querySelector('[data-role-home-label]');
    if (label) label.textContent = HOME_LABEL[role];
  });
  document.querySelectorAll<HTMLAnchorElement>('[data-role-cta]').forEach((a) => {
    a.href = role === 'donante' ? '/donante/donar' : ROLE_HOME[role];
    a.textContent = CTA_LABEL[role];
  });

  if (role === 'operador') {
    const k = kpis();
    fill('[data-user-blood]', ROLE_LABEL.operador);
    fill('[data-op-centro]', operadorActual().centro);
    fill('[data-op-pendientes]', String(k.pedidosPendientes));
    fill('[data-op-verificar]', String(k.porVerificar));
    fill('[data-next-appointment-short]', k.pedidosPendientes ? `${k.pedidosPendientes} pedidos pendientes` : 'Sin pedidos pendientes');
    return true;
  }

  if (role === 'laboratorio') {
    const k = kpisLab();
    fill('[data-user-blood]', ROLE_LABEL.laboratorio);
    fill('[data-op-centro]', operadorActual().centro);
    fill('[data-lab-pendientes]', String(k.porAnalizar));
    fill('[data-lab-positivos]', String(k.positivosSinNotificar));
    fill('[data-next-appointment-short]', k.porAnalizar ? `${k.porAnalizar} muestras por analizar` : 'Sin muestras pendientes');
    return true;
  }

  if (role === 'soporte') {
    const k = kpisSoporte();
    fill('[data-user-blood]', ROLE_LABEL.soporte);
    fill('[data-op-centro]', operadorActual().centro);
    fill('[data-sop-abiertos]', String(k.sinResolver));
    fill('[data-sop-mios]', String(k.mios));
    fill('[data-next-appointment-short]', k.sinAsignar ? `${k.sinAsignar} solicitudes sin asignar` : 'Sin solicitudes pendientes');
    return true;
  }

  if (role === 'director') {
    const porAprobar = getPedidosPorAprobar().length;
    fill('[data-user-blood]', ROLE_LABEL.director);
    fill('[data-op-centro]', operadorActual().centro);
    fill('[data-dir-pendientes]', String(porAprobar));
    fill('[data-next-appointment-short]', porAprobar ? `${porAprobar} solicitudes por aprobar` : 'Sin solicitudes por aprobar');
    return true;
  }

  // Donante: tipo de sangre del perfil (o el de la sesión) y próxima cita
  const blood = loadDonor().sangre || (user as { bloodType?: string }).bloodType || '';
  fill('[data-user-blood]', blood ? blood.replace('-', '−') : '');

  const next = nextAppointment(user.email); // sistema de citas existente
  const own = getCita(); // cita agendada desde /donante/donar
  let long = 'Aún no tienes citas agendadas.';
  let short = 'Sin citas agendadas';
  if (next) {
    long = `${next.centerName}, ${appointmentLabel(next)}`;
    short = `Próxima cita: ${appointmentLabel(next)}`;
  } else if (own) {
    const when = `${fmtFecha(own.fecha, { day: 'numeric', month: 'short' })} · ${own.hora}`;
    long = `${centroById(own.centroId)?.name ?? 'Centro de donación'}, ${when}`;
    short = `Próxima cita: ${when}`;
  }
  fill('[data-next-appointment]', long);
  fill('[data-next-appointment-short]', short);
  return true;
}
// ------------------------------------------------------------------ Foto del usuario en avatares
/**
 * Pone la foto del usuario (la misma de su perfil o carnet) en los círculos de iniciales de la barra, el menú
 * de cuenta y el menú lateral. Va como fondo para que los scripts que escriben las iniciales no la borren.
 */
export async function pintarFotoUsuario(): Promise<void> {
  const user = getSession();
  if (!user) return;
  let url: string | null = null;
  try {
    if (roleOf(user) === 'donante') {
      const { loadDonor, urlFoto } = await import('./donante');
      url = await urlFoto(loadDonor().foto);
    } else {
      const { cargarPerfil, fotoRemota } = await import('./personal');
      const { usaSupabase } = await import('./supabase');
      url = usaSupabase() ? await fotoRemota() : cargarPerfil().foto || null;
    }
  } catch {
    url = null;
  }
  document.querySelectorAll<HTMLElement>('[data-user-initials]').forEach((el) => {
    if (url) {
      el.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.color = 'transparent';
    } else {
      el.style.backgroundImage = '';
      el.style.color = '';
    }
  });
}
