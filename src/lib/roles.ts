// src/lib/roles.ts
// Un solo lugar para saber "quién es el usuario": rol, página de inicio y protección de rutas.
//
// El rol sale de la sesión (session.role). Si tu lib/auth lo guarda con otro nombre,
// solo hay que ajustar `rawRole()`. Al iniciar sesión, redirige con `homeFor(rol)`.
//
// OJO: guard() es una comodidad de interfaz, NO seguridad. La autorización real debe hacerla el backend.

import { getSession } from './auth';
import type { Role } from './auth';

export type { Role };

export const ROLE_HOME: Record<Role, string> = {
  donante: '/donante/perfil',
  operador: '/operador/panel',
  laboratorio: '/laboratorio/panel',
  soporte: '/soporte/panel',
  director: '/director/dashboard',
};

export const ROLE_LABEL: Record<Role, string> = {
  donante: 'Donante',
  operador: 'Operador',
  laboratorio: 'Laboratorio',
  soporte: 'Soporte',
  director: 'Director',
};

export function normalizeRole(v: unknown): Role | null {
  const s = String(v ?? '').toLowerCase().trim();
  if (['donante', 'donor', 'user', 'usuario'].includes(s)) return 'donante';
  if (['operador', 'operator', 'op'].includes(s)) return 'operador';
  if (['laboratorio', 'laboratorista', 'lab', 'bioanalista'].includes(s)) return 'laboratorio';
  if (['soporte', 'support', 'agente', 'atencion'].includes(s)) return 'soporte';
  if (['director', 'admin', 'administrador'].includes(s)) return 'director';
  return null;
}

const rawRole = (user: unknown) => {
  const u = (user ?? {}) as Record<string, unknown>;
  return u.role ?? u.rol ?? u.userType ?? u.tipo;
};

/** Rol del usuario con sesión (por defecto "donante"). En desarrollo se puede forzar con localStorage 'blud-dev-role'. */
export function roleOf(user: unknown = getSession()): Role {
  if (import.meta.env?.DEV) {
    try {
      const forced = normalizeRole(localStorage.getItem('blud-dev-role'));
      if (forced) return forced;
    } catch {}
  }
  return normalizeRole(rawRole(user)) ?? 'donante';
}

export const homeFor = (role: Role) => ROLE_HOME[role];

/** Redirige si no hay sesión o si el rol no corresponde a la zona. Devuelve true si puede quedarse. */
export function guard(allowed: Role[]): boolean {
  const user = getSession();
  if (!user) {
    window.location.replace('/login');
    return false;
  }
  const role = roleOf(user);
  document.documentElement.dataset.role = role;
  if (!allowed.includes(role)) {
    window.location.replace(ROLE_HOME[role]);
    return false;
  }
  return true;
}