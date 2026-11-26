// src/lib/administracion.ts
// Administración técnica de soporte (RF-A1, A2, A3):
//   - Cuentas: buscar cualquier cuenta, activar o desactivar, cambiar rol y sede del personal, quitar la verificación
//     en dos pasos y enviar el correo para restablecer el acceso.
//   - Incidencias técnicas: registrar fallas, tomarlas, dar seguimiento y cerrarlas con su resolución.
//   - Corrección de estados: unidad, tamizaje o muestra de tipaje, con motivo obligatorio.
// Toda acción pide un motivo y queda en la bitácora. Con base real: migración 20261125150000.
// En modo demo los cambios viven en el navegador y se ven también en la bitácora de ejemplo.

import { getSession, listarPersonal, solicitarRecuperacion } from './auth';
import { pruebas, registro } from './db';
import { unidadesInventario } from './operador';
import { rpc, validarMotivo } from './rpc';
import { usaSupabase } from './supabase';

export { NoDisponible, MENSAJE_NO_DISPONIBLE } from './rpc';

const demoLeer = <T>(k: string, def: T): T => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? def; } catch { return def; } };
const demoEscribir = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  try { window.dispatchEvent(new CustomEvent('blud:db', { detail: { key: k } })); } catch {}
};
const yo = () => String(getSession()?.name ?? 'Soporte');

/** Bitácora de las acciones administrativas en modo demo (la lee lib/bitacora). */
export const DEMO_LOG = 'blud-demo-admin-log';
function anotar(tabla: string, registro: string | number, operacion: string, detalle: Record<string, unknown>) {
  const l = demoLeer<unknown[]>(DEMO_LOG, []);
  demoEscribir(DEMO_LOG, [{ id: 'a' + Date.now(), fecha: new Date().toISOString(), tabla, registro, operacion, usuario: yo(), sede: 'Banco de Sangre del Zulia', detalle }, ...l].slice(0, 300));
}
const exigir = (motivo: string) => { const e = validarMotivo(motivo); if (e) throw new Error(e); return motivo.trim(); };

// ================================================================== RF-A1 · Cuentas
export type RolCuenta = 'donante' | 'operador' | 'laboratorio' | 'soporte' | 'director';
export const ROL_LABEL: Record<RolCuenta, string> = {
  donante: 'Donante', operador: 'Operador', laboratorio: 'Laboratorio', soporte: 'Soporte', director: 'Dirección',
};
export const ROLES_PERSONAL: RolCuenta[] = ['operador', 'laboratorio', 'soporte', 'director'];

export interface Cuenta {
  id: number | string;
  email: string;
  nombre: string;
  cedula?: string;
  rol: RolCuenta;
  cargo?: string;
  sede?: { id?: number | string; nombre?: string };
  activo: boolean;
  registrado?: string;
  ultimoAcceso?: string;
  confirmado?: boolean;
  dosPasos?: boolean;
  presencial?: boolean;
}
export interface FiltroCuentas { q?: string; rol?: string; activo?: '' | 'si' | 'no' }
export interface PaginaCuentas { items: Cuenta[]; siguiente: string | null }

const DEMO_CUENTAS = 'blud-demo-cuentas';
const INACTIVOS = 'blud-staff-inactive'; // el mismo que usa lib/auth para impedir el inicio de sesión
type Ajuste = { rol?: RolCuenta; sede?: { id?: string | number; nombre?: string }; dosPasos?: boolean };

function cuentasDemo(): Cuenta[] {
  const aj = demoLeer<Record<string, Ajuste>>(DEMO_CUENTAS, {});
  const off = new Set(demoLeer<string[]>(INACTIVOS, []));
  const personal: Cuenta[] = listarPersonal().map((p) => ({
    id: p.email, email: p.email, nombre: p.name, rol: p.role as RolCuenta, cargo: p.cargo, activo: !off.has(p.email),
    sede: { nombre: p.sede ?? 'Banco de Sangre del Zulia' }, confirmado: true, dosPasos: p.email === 'operador@blud.app',
  }));
  const donantes: Cuenta[] = registro.all().filter((d) => d.email).map((d) => ({
    id: d.email!.toLowerCase(), email: d.email!.toLowerCase(), nombre: d.nombreCompleto, cedula: d.cedula, rol: 'donante' as RolCuenta,
    activo: !off.has(d.email!.toLowerCase()), registrado: d.fechaRegistro, confirmado: true,
  }));
  return [...personal, ...donantes].map((c) => ({ ...c, ...aj[c.email], rol: aj[c.email]?.rol ?? c.rol }));
}

export async function buscarCuentas(f: FiltroCuentas, cursor: string | null, limite = 25): Promise<PaginaCuentas> {
  const q = (f.q?.trim().length ?? 0) >= 3 ? f.q!.trim().toLowerCase() : '';
  const activo = f.activo === 'si' ? true : f.activo === 'no' ? false : null;
  if (!usaSupabase()) {
    const todo = cuentasDemo().filter((c) =>
      (!f.rol || (f.rol === 'personal' ? c.rol !== 'donante' : c.rol === f.rol)) &&
      (activo === null || c.activo === activo) &&
      (!q || `${c.nombre} ${c.email} ${c.cedula ?? ''}`.toLowerCase().includes(q)));
    const desde = cursor ? Number(cursor) : 0;
    return { items: todo.slice(desde, desde + limite), siguiente: desde + limite < todo.length ? String(desde + limite) : null };
  }
  const r = await rpc<{ items: Cuenta[]; siguiente: string | null }>('blud_cuentas', {
    p_q: q || null, p_rol: f.rol || null, p_activo: activo, p_cursor: cursor ? Number(cursor) : null, p_limite: limite,
  });
  return { items: r.items ?? [], siguiente: r.siguiente ?? null };
}

function ajustarDemo(email: string, cambio: Ajuste) {
  const aj = demoLeer<Record<string, Ajuste>>(DEMO_CUENTAS, {});
  aj[email] = { ...aj[email], ...cambio };
  demoEscribir(DEMO_CUENTAS, aj);
}
const propia = (c: Cuenta) => c.email === String(getSession()?.email ?? '').toLowerCase();

export async function cambiarActivo(c: Cuenta, activo: boolean, motivo: string): Promise<Cuenta> {
  const m = exigir(motivo);
  if (propia(c)) throw new Error('No puedes cambiar tu propia cuenta desde aquí.');
  if (usaSupabase()) return rpc<Cuenta>('blud_cuenta_activo', { p_id: c.id, p_activo: activo, p_motivo: m });
  const off = new Set(demoLeer<string[]>(INACTIVOS, []));
  if (activo) off.delete(c.email); else off.add(c.email);
  demoEscribir(INACTIVOS, [...off]);
  anotar('usuario', c.email, activo ? 'CUENTA_ACTIVADA' : 'CUENTA_DESACTIVADA', { correo: c.email, motivo: m });
  return { ...c, activo };
}

export async function cambiarRol(c: Cuenta, rol: RolCuenta, sede: { id: string | number; nombre: string }, motivo: string): Promise<Cuenta> {
  const m = exigir(motivo);
  if (propia(c)) throw new Error('No puedes cambiar tu propia cuenta desde aquí.');
  if (c.rol === 'donante') throw new Error('Solo se cambia el rol de cuentas del personal de salud.');
  if (!ROLES_PERSONAL.includes(rol)) throw new Error('Rol no válido.');
  if (usaSupabase()) return rpc<Cuenta>('blud_cuenta_rol', { p_id: c.id, p_rol: rol, p_sede: Number(sede.id), p_motivo: m });
  ajustarDemo(c.email, { rol, sede });
  anotar('personalsalud', c.email, 'CUENTA_ROL', { correo: c.email, rol, sede: sede.nombre, motivo: m });
  return { ...c, rol, sede };
}

export async function quitarDosPasos(c: Cuenta, motivo: string): Promise<Cuenta> {
  const m = exigir(motivo);
  if (propia(c)) throw new Error('No puedes cambiar tu propia cuenta desde aquí.');
  if (!c.dosPasos) throw new Error('Esa cuenta no tiene verificación en dos pasos.');
  if (usaSupabase()) return rpc<Cuenta>('blud_cuenta_quitar_2fa', { p_id: c.id, p_motivo: m });
  ajustarDemo(c.email, { dosPasos: false });
  anotar('usuario', c.email, 'CUENTA_2FA_QUITADA', { correo: c.email, motivo: m });
  return { ...c, dosPasos: false };
}

/** Envía el correo para crear una contraseña nueva y deja constancia en la bitácora. */
export async function restablecerAcceso(c: Cuenta, motivo: string): Promise<string> {
  const m = exigir(motivo);
  if (c.presencial) throw new Error('Esta cuenta se registró en el centro y no tiene un correo real. Actualiza su correo primero.');
  if (!usaSupabase()) {
    anotar('usuario', c.email, 'RESTABLECER_ACCESO', { correo: c.email, motivo: m });
    return `En modo demo no se envían correos. En producción, ${c.email} recibiría el enlace para crear una contraseña nueva.`;
  }
  const r = await solicitarRecuperacion(c.email);
  if (!r.ok) throw new Error(r.error);
  await rpc('blud_cuenta_constancia', { p_id: c.id, p_accion: 'RESTABLECER_ACCESO', p_motivo: m });
  return `Enviamos a ${c.email} el enlace para crear una contraseña nueva. Vence en una hora.`;
}

// ================================================================== RF-A2 · Incidencias técnicas
export type EstadoIncidencia = 'abierta' | 'en_proceso' | 'resuelta' | 'descartada';
export const ESTADO_INCIDENCIA: Record<EstadoIncidencia, string> = {
  abierta: 'Abierta', en_proceso: 'En proceso', resuelta: 'Resuelta', descartada: 'Descartada',
};
export const CATEGORIAS = ['Plataforma', 'Cuentas', 'Inventario', 'Laboratorio', 'Equipos', 'Integraciones', 'Otro'] as const;
export const SEVERIDADES = ['Baja', 'Media', 'Alta', 'Crítica'] as const;

export interface Seguimiento { fecha: string; autor?: string; texto: string; estado?: EstadoIncidencia }
export interface Incidencia {
  id: string; titulo: string; descripcion: string; categoria: string; severidad: string; estado: EstadoIncidencia;
  sede?: string; reportadoPor?: string; asignadoA?: { id: number | string; nombre: string }; ticketId?: string; ticketCodigo?: string;
  seguimiento: Seguimiento[]; resolucion?: string; creado: string; actualizado: string; resueltoEn?: string;
}
export interface PaginaIncidencias {
  items: Incidencia[]; siguiente: string | null; resumen: { abiertas: number; enProceso: number; criticas: number };
}

const DEMO_INC = 'blud-demo-incidencias';
function incidenciasDemo(): Incidencia[] {
  let l = demoLeer<Incidencia[] | null>(DEMO_INC, null);
  if (!l) {
    const hace = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
    l = [
      { id: 'INC-2026-0002', titulo: 'El escáner de QR no abre la cámara en la tablet de admisión', descripcion: 'En la tablet Samsung del área de admisión, al pulsar «Escanear» la cámara queda en negro. En el teléfono del operador funciona.', categoria: 'Plataforma', severidad: 'Media', estado: 'en_proceso', sede: 'Banco de Sangre del Zulia', reportadoPor: 'Soporte de ejemplo', asignadoA: { id: 'soporte@blud.app', nombre: 'Soporte de ejemplo' }, seguimiento: [{ fecha: hace(30), autor: 'Soporte de ejemplo', texto: 'Incidencia registrada.', estado: 'abierta' }, { fecha: hace(6), autor: 'Soporte de ejemplo', texto: 'El navegador de la tablet no tiene permiso de cámara. Se pidió al operador revisar la configuración.', estado: 'en_proceso' }], creado: hace(30), actualizado: hace(6) },
      { id: 'INC-2026-0001', titulo: 'Unidad marcada como reservada sin solicitud activa', descripcion: 'Una bolsa de plasma quedó en estado Reservado después de anular la solicitud. No aparece en el inventario disponible.', categoria: 'Inventario', severidad: 'Alta', estado: 'abierta', sede: 'Banco de Sangre del Zulia', reportadoPor: 'Soporte de ejemplo', seguimiento: [{ fecha: hace(50), autor: 'Soporte de ejemplo', texto: 'Incidencia registrada.', estado: 'abierta' }], creado: hace(50), actualizado: hace(50) },
    ];
    demoEscribir(DEMO_INC, l);
  }
  return l;
}

export async function listarIncidencias(o: { estado?: string; q?: string }, cursor: string | null, limite = 25): Promise<PaginaIncidencias> {
  const q = (o.q?.trim().length ?? 0) >= 3 ? o.q!.trim().toLowerCase() : '';
  if (!usaSupabase()) {
    const todas = incidenciasDemo();
    const activas = (i: Incidencia) => i.estado === 'abierta' || i.estado === 'en_proceso';
    const f = todas.filter((i) => (!o.estado || (o.estado === 'activas' ? activas(i) : i.estado === o.estado)) &&
      (!q || `${i.id} ${i.titulo} ${i.descripcion}`.toLowerCase().includes(q)));
    const desde = cursor ? Number(cursor) : 0;
    return {
      items: f.slice(desde, desde + limite), siguiente: desde + limite < f.length ? String(desde + limite) : null,
      resumen: { abiertas: todas.filter((i) => i.estado === 'abierta').length, enProceso: todas.filter((i) => i.estado === 'en_proceso').length,
        criticas: todas.filter((i) => activas(i) && (i.severidad === 'Alta' || i.severidad === 'Crítica')).length },
    };
  }
  const r = await rpc<PaginaIncidencias>('blud_incidencias', { p_estado: o.estado || null, p_q: q || null, p_cursor: cursor, p_limite: limite });
  return { items: r.items ?? [], siguiente: r.siguiente ?? null, resumen: r.resumen ?? { abiertas: 0, enProceso: 0, criticas: 0 } };
}

export interface DatosIncidencia {
  id?: string; titulo?: string; descripcion?: string; categoria?: string; severidad?: string; ticketId?: string;
  estado?: EstadoIncidencia; nota?: string; resolucion?: string; asignarme?: boolean;
}

export async function guardarIncidencia(d: DatosIncidencia): Promise<Incidencia> {
  if (!d.id) {
    if ((d.titulo?.trim().length ?? 0) < 5) throw new Error('Escribe un título claro (mínimo 5 caracteres).');
    if ((d.descripcion?.trim().length ?? 0) < 15) throw new Error('Describe la falla (mínimo 15 caracteres).');
  }
  if ((d.estado === 'resuelta' || d.estado === 'descartada') && (d.resolucion?.trim().length ?? 0) < 10) {
    throw new Error('Explica cómo se resolvió o por qué se descarta (mínimo 10 caracteres).');
  }
  if (usaSupabase()) return rpc<Incidencia>('blud_incidencia_guardar', { p: d });

  const l = incidenciasDemo();
  const ahora = new Date().toISOString();
  if (!d.id) {
    const n = l.length + 1;
    const i: Incidencia = {
      id: `INC-${ahora.slice(0, 4)}-${String(n).padStart(4, '0')}`, titulo: d.titulo!.trim(), descripcion: d.descripcion!.trim(),
      categoria: d.categoria || 'Plataforma', severidad: d.severidad || 'Media', estado: 'abierta', sede: 'Banco de Sangre del Zulia',
      reportadoPor: yo(), asignadoA: { id: String(getSession()?.email), nombre: yo() }, ticketId: d.ticketId,
      seguimiento: [{ fecha: ahora, autor: yo(), texto: 'Incidencia registrada.', estado: 'abierta' }], creado: ahora, actualizado: ahora,
    };
    demoEscribir(DEMO_INC, [i, ...l]);
    anotar('incidencia_tecnica', i.id, 'INCIDENCIA_CREADA', { codigo: i.id, severidad: i.severidad });
    return i;
  }
  const prev = l.find((x) => x.id === d.id);
  if (!prev) throw new Error('No encontramos esa incidencia.');
  if (!d.estado && !d.nota?.trim() && !d.asignarme && !d.severidad) throw new Error('No hay cambios que guardar.');
  const estado = d.estado ?? prev.estado;
  const i: Incidencia = {
    ...prev, estado, severidad: d.severidad || prev.severidad, actualizado: ahora,
    asignadoA: d.asignarme ? { id: String(getSession()?.email), nombre: yo() } : prev.asignadoA,
    resolucion: d.resolucion?.trim() || prev.resolucion,
    resueltoEn: estado === 'resuelta' || estado === 'descartada' ? prev.resueltoEn ?? ahora : undefined,
    seguimiento: d.nota?.trim() || d.estado
      ? [...prev.seguimiento, { fecha: ahora, autor: yo(), texto: d.nota?.trim() || 'Cambio de estado.', estado: d.estado }] : prev.seguimiento,
  };
  demoEscribir(DEMO_INC, l.map((x) => (x.id === i.id ? i : x)));
  if (d.estado) anotar('incidencia_tecnica', i.id, 'INCIDENCIA_' + d.estado.toUpperCase(), { codigo: i.id });
  return i;
}

// ================================================================== RF-A3 · Corrección de estados
export type TipoRegistro = 'unidad' | 'prueba' | 'tipaje';
export const TIPO_REGISTRO: Record<TipoRegistro, { label: string; ayuda: string; ejemplo: string }> = {
  unidad: { label: 'Unidad (bolsa)', ayuda: 'Código de la bolsa', ejemplo: 'Ej. DON-AB12CD o U-125' },
  prueba: { label: 'Tamizaje de una donación', ayuda: 'Código de la donación o DIN ISBT', ejemplo: 'Ej. DON-AA000123' },
  tipaje: { label: 'Muestra de tipaje', ayuda: 'Solicitud de transfusión', ejemplo: 'Ej. REQ-000042' },
};
export const ESTADO_LEGIBLE: Record<string, string> = { EnTransito: 'En tránsito' };

export interface RegistroEstado { tipo: TipoRegistro; id: number | string; ref: string; estado: string; detalle: string; opciones: string[] }
export interface Correccion { id: number | string; fecha: string; tabla: string; registro: number | string; usuario?: string; detalle: { antes?: string; despues?: string; motivo?: string; incidencia?: string } }

const DEMO_EST = 'blud-demo-estados';
export async function consultarRegistro(tipo: TipoRegistro, ref: string): Promise<RegistroEstado> {
  const r = ref.trim();
  if (r.length < 3) throw new Error('Escribe el código del registro.');
  if (usaSupabase()) return rpc<RegistroEstado>('blud_registro_estado', { p_tipo: tipo, p_ref: r });
  const ov = demoLeer<Record<string, string>>(DEMO_EST, {});
  const R = r.toUpperCase();
  if (tipo === 'unidad') {
    const u = unidadesInventario().find((x) => x.codigo.toUpperCase() === R || x.id.toUpperCase() === R);
    if (!u) throw new Error('No encontramos esa unidad en el inventario de ejemplo.');
    return { tipo, id: u.id, ref: u.codigo, estado: ov[`unidad:${u.id}`] ?? 'Disponible', detalle: `${u.componente} · ${u.tipoSangre} · vence ${u.vence}`,
      opciones: ['Cuarentena', 'Disponible', 'Reservado', 'EnTransito', 'Descartado', 'Transfundido'] };
  }
  if (tipo === 'prueba') {
    const p = pruebas.all().find((x) => x.codigo.toUpperCase() === R);
    if (!p) throw new Error('No encontramos el tamizaje de esa donación.');
    const base = p.resultadoGlobal === 'positivo' ? 'Positivo' : p.resultadoGlobal === 'negativo' ? 'Negativo' : 'Indeterminado';
    return { tipo, id: p.id, ref: p.codigo, estado: ov[`prueba:${p.id}`] ?? base, detalle: `${p.tipoSangreConfirmado} · analizada ${p.fecha}`, opciones: ['Negativo', 'Positivo', 'Indeterminado'] };
  }
  throw new Error('Las muestras de tipaje solo existen con la base conectada.');
}

export async function corregirEstado(r: RegistroEstado, nuevo: string, motivo: string, incidencia?: string): Promise<void> {
  const m = exigir(motivo);
  if (nuevo === r.estado) throw new Error('El registro ya tiene ese estado.');
  if (usaSupabase()) {
    await rpc('blud_corregir_estado', { p_tipo: r.tipo, p_id: Number(r.id), p_nuevo: nuevo, p_motivo: m, p_incidencia: incidencia?.trim() || null });
    return;
  }
  const ov = demoLeer<Record<string, string>>(DEMO_EST, {});
  ov[`${r.tipo}:${r.id}`] = nuevo;
  demoEscribir(DEMO_EST, ov);
  const tabla = r.tipo === 'unidad' ? 'unidadsangre' : r.tipo === 'prueba' ? 'prueba_serologica' : 'prueba_tipaje_muestra';
  anotar(tabla, r.ref, 'CORRECCION_ESTADO', { antes: r.estado, despues: nuevo, motivo: m, incidencia: incidencia?.trim() || undefined });
  if (incidencia?.trim()) {
    const l = incidenciasDemo();
    demoEscribir(DEMO_INC, l.map((i) => i.id === incidencia.trim() ? { ...i, actualizado: new Date().toISOString(),
      seguimiento: [...i.seguimiento, { fecha: new Date().toISOString(), autor: yo(), texto: `Corrección: ${r.ref} de ${r.estado} a ${nuevo}. ${m}` }] } : i));
  }
}

export async function ultimasCorrecciones(): Promise<Correccion[]> {
  if (usaSupabase()) return (await rpc<Correccion[]>('blud_correcciones', { p_limite: 20 })) ?? [];
  return demoLeer<(Correccion & { operacion: string })[]>(DEMO_LOG, []).filter((e) => e.operacion === 'CORRECCION_ESTADO').slice(0, 20);
}
