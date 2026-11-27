// src/lib/avisos.ts
// Centro de avisos del personal: lo que espera una acción de este rol, calculado con lo que ya hay en la caché
// y con las bandejas de la base (citas, compatibilidad, pedidos entre centros, hemovigilancia).
// Un aviso desaparece solo cuando se resuelve la causa: no hay «marcar como leído».
// Cada fuente se consulta por separado: si una falla (sin conexión, función no disponible) las demás siguen.

import type { IconKey } from './menus';
import type { Role } from './roles';
import { usaSupabase } from './supabase';

export type Nivel = 'alta' | 'media' | 'info';

export interface Aviso {
  id: string;
  nivel: Nivel;
  icono: IconKey;
  titulo: string;
  detalle: string;
  href: string;
  accion: string;
}

export const NIVEL_LABEL: Record<Nivel, string> = { alta: 'Urgente', media: 'Pendiente', info: 'Para revisar' };
const ORDEN: Record<Nivel, number> = { alta: 0, media: 1, info: 2 };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Ejecuta una fuente de avisos sin que un error tumbe al resto. */
async function fuente(fn: () => Promise<Aviso[]> | Aviso[]): Promise<Aviso[]> {
  try { return await fn(); } catch { return []; }
}

// ------------------------------------------------------------------ Inventario (operador y dirección)
async function inventario(base: string): Promise<Aviso[]> {
  const { resumenInventario } = await import('./director');
  const inv = resumenInventario();
  const out: Aviso[] = [];
  if (inv.tiposCriticos.length) out.push({
    id: 'stock-bajo', nivel: 'alta', icono: 'package', titulo: `Stock bajo en ${plural(inv.tiposCriticos.length, 'grupo', 'grupos')}`,
    detalle: `Menos de 3 unidades vigentes de ${inv.tiposCriticos.join(', ')}.`, href: `${base}`, accion: 'Ver inventario',
  });
  if (inv.vencidas.length) out.push({
    id: 'vencidas', nivel: 'media', icono: 'alert', titulo: `${plural(inv.vencidas.length, 'unidad vencida', 'unidades vencidas')} en el inventario`,
    detalle: 'Retíralas del stock y regístralas como descarte.', href: base, accion: 'Revisar unidades',
  });
  if (inv.porVencer.length) out.push({
    id: 'por-vencer', nivel: 'info', icono: 'clock', titulo: `${plural(inv.porVencer.length, 'unidad está', 'unidades están')} por vencer`,
    detalle: 'Úsalas primero en los próximos despachos (alerta: eritrocitos 7 días, plasma 30, plaquetas 48 horas).', href: base, accion: 'Ver vencimientos',
  });
  return out;
}

// ------------------------------------------------------------------ Hemovigilancia
async function hemovigilancia(rol: Role): Promise<Aviso[]> {
  const { listarHV, esGrave, alertasTiempo } = await import('./hemovigilancia');
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const { registros, pendientes } = await listarHV({ desde, red: false });
  const href = `/${rol}/hemovigilancia`;
  const out: Aviso[] = [];
  if (rol === 'operador' && pendientes.length) out.push({
    id: 'hv-pendientes', nivel: 'media', icono: 'alert', titulo: `${plural(pendientes.length, 'unidad despachada', 'unidades despachadas')} sin registro de transfusión`,
    detalle: 'Registra la doble verificación, los signos vitales y cómo terminó cada transfusión.', href, accion: 'Registrar',
  });
  const enCurso = registros.filter((r) => r.estado === 'en_curso');
  const fueraDeTiempo = enCurso.filter((r) => alertasTiempo(r).length);
  if (rol === 'operador' && fueraDeTiempo.length) out.push({
    id: 'hv-fuera-tiempo', nivel: 'alta', icono: 'clock', titulo: `${plural(fueraDeTiempo.length, 'transfusión fuera de tiempo', 'transfusiones fuera de tiempo')}`,
    detalle: 'Pasó de 4 horas de infusión o se inició más de 30 min después del despacho. Revisa y cierra el registro.', href, accion: 'Revisar',
  });
  const enCursoATiempo = enCurso.length - fueraDeTiempo.length;
  if (rol === 'operador' && enCursoATiempo) out.push({
    id: 'hv-en-curso', nivel: 'info', icono: 'clock', titulo: `${plural(enCursoATiempo, 'transfusión en curso', 'transfusiones en curso')}`,
    detalle: 'Completa los signos al terminar y cierra el registro.', href, accion: 'Completar',
  });
  // RF-H4: la dirección notifica al comité cada evento adverso.
  const eventos = registros.filter((r) => r.tipoEvento && r.tipoEvento !== 'sin_reaccion' && !r.comite);
  const graves = eventos.filter(esGrave);
  if (rol === 'director' && graves.length) out.push({
    id: 'hv-graves', nivel: 'alta', icono: 'alert', titulo: `${plural(graves.length, 'reacción grave sin notificar', 'reacciones graves sin notificar')} al comité`,
    detalle: graves.slice(0, 2).map((r) => `${r.id}: ${r.categoria ?? 'sin categoría'}`).join(' · '), href, accion: 'Notificar',
  });
  const leves = eventos.length - graves.length;
  if (rol === 'director' && leves) out.push({
    id: 'hv-reacciones', nivel: 'media', icono: 'alert', titulo: `${plural(leves, 'evento adverso', 'eventos adversos')} sin notificar al comité`,
    detalle: 'Leves o moderados. Revisa la imputabilidad y notifícalos.', href, accion: 'Revisar',
  });
  return out;
}

// ------------------------------------------------------------------ Seguridad transfusional (RF-TR7 y RF-H6)
async function seguridad(rol: Role): Promise<Aviso[]> {
  const out: Aviso[] = [];
  const pagina = rol === 'laboratorio' ? '/laboratorio/compatibilidad' : '/operador/entregas';
  if (usaSupabase()) {
    const { listarIncompatibilidades } = await import('./transfusion');
    const sinAviso = (await listarIncompatibilidades()).filter((i) => !i.aviso);
    if (sinAviso.length) out.push({
      id: 'incompatibles', nivel: 'alta', icono: 'alert', titulo: `${plural(sinAviso.length, 'prueba cruzada incompatible', 'pruebas cruzadas incompatibles')} sin avisar al médico`,
      detalle: sinAviso.slice(0, 2).map((i) => `${i.solicitud} · ${i.paciente.nombre}`).join(' · '), href: pagina, accion: 'Registrar aviso',
    });
  }
  const { devolucionesPendientes } = await import('./hemovigilancia');
  const devs = await devolucionesPendientes();
  if (devs.length) out.push({
    id: 'devoluciones', nivel: rol === 'laboratorio' ? 'alta' : 'info', icono: 'package',
    titulo: `${plural(devs.length, 'bolsa devuelta', 'bolsas devueltas')} ${rol === 'laboratorio' ? 'por recibir' : 'sin confirmar por el laboratorio'}`,
    detalle: devs.slice(0, 2).map((r) => `${r.unidadCodigo ?? r.id}: ${r.devolucion?.motivo ?? ''}`).join(' · '), href: pagina,
    accion: rol === 'laboratorio' ? 'Confirmar recepción' : 'Ver',
  });
  return out;
}

// ------------------------------------------------------------------ Pedidos entre centros (solo base real)
async function pedidosCentros(rol: Role): Promise<Aviso[]> {
  if (!usaSupabase()) return [];
  const { bandejaCentros } = await import('./centros');
  const b = await bandejaCentros();
  const out: Aviso[] = [];
  if (rol === 'director') {
    const porAprobar = b.recibidos.filter((p) => p.estado === 'pendiente');
    const criticos = porAprobar.filter((p) => p.prioridad !== 'normal').length;
    if (porAprobar.length) out.push({
      id: 'centros-aprobar', nivel: criticos ? 'alta' : 'media', icono: 'inbox',
      titulo: `${plural(porAprobar.length, 'pedido de otro centro', 'pedidos de otros centros')} por aprobar`,
      detalle: porAprobar.slice(0, 2).map((p) => `${p.solicitante.nombre}: ${p.unidades} u. ${p.tipoSangre} ${p.componente}`).join(' · '),
      href: '/director/solicitudes/historial', accion: 'Revisar pedidos',
    });
    const rechazados = b.enviados.filter((p) => p.estado === 'rechazada' && p.revisadoEn && Date.now() - new Date(p.revisadoEn).getTime() < 7 * 86400000);
    if (rechazados.length) out.push({
      id: 'centros-rechazados', nivel: 'info', icono: 'inbox', titulo: `${plural(rechazados.length, 'pedido tuyo fue rechazado', 'pedidos tuyos fueron rechazados')} esta semana`,
      detalle: 'Puedes pedir las unidades a otro centro.', href: '/director/solicitudes/historial', accion: 'Ver motivo',
    });
    if (b.sinStock.length) out.push({
      id: 'sin-stock', nivel: 'media', icono: 'package', titulo: `${plural(b.sinStock.length, 'transfusión espera', 'transfusiones esperan')} stock en tu sede`,
      detalle: 'Pide las unidades a otro centro desde Solicitudes entre centros.', href: '/director/solicitudes/historial', accion: 'Pedir unidades',
    });
  }
  if (rol === 'operador') {
    const despachar = b.recibidos.filter((p) => p.estado === 'aprobada').length;
    const recibir = b.enviados.filter((p) => p.estado === 'despachada').length;
    if (despachar) out.push({
      id: 'centros-despachar', nivel: 'media', icono: 'truck', titulo: `${plural(despachar, 'pedido aprobado', 'pedidos aprobados')} para enviar a otro centro`,
      detalle: 'Tu dirección ya los aprobó y las unidades están reservadas.', href: '/operador/entregas', accion: 'Despachar',
    });
    if (recibir) out.push({
      id: 'centros-recibir', nivel: 'media', icono: 'truck', titulo: `${plural(recibir, 'pedido viene', 'pedidos vienen')} en camino a tu centro`,
      detalle: 'Confirma la recepción cuando lleguen las bolsas.', href: '/operador/entregas', accion: 'Confirmar recepción',
    });
  }
  return out;
}

// ------------------------------------------------------------------ Compatibilidad (operador y laboratorio, base real)
async function compatibilidad(rol: Role): Promise<Aviso[]> {
  if (!usaSupabase()) return [];
  const { listarTransfusiones } = await import('./transfusion');
  const lista = (await listarTransfusiones()).filter((t) => t.estado !== 'despachado');
  const out: Aviso[] = [];
  if (rol === 'laboratorio') {
    const sinTipaje = lista.filter((t) => !t.tipaje || !t.tipaje.conforme);
    const sinCruzada = lista.filter((t) => t.tipaje?.conforme && t.requiereCruzada && t.unidades.some((u) => !u.cruzada));
    const urgentes = [...sinTipaje, ...sinCruzada].filter((t) => t.prioridad !== 'normal').length;
    if (sinTipaje.length) out.push({
      id: 'tipaje', nivel: urgentes ? 'alta' : 'media', icono: 'verify', titulo: `${plural(sinTipaje.length, 'muestra espera', 'muestras esperan')} tipaje`,
      detalle: sinTipaje.slice(0, 2).map((t) => `${t.id} · ${t.paciente.nombre}`).join(' · '), href: '/laboratorio/compatibilidad', accion: 'Hacer tipaje',
    });
    if (sinCruzada.length) out.push({
      id: 'cruzada', nivel: urgentes ? 'alta' : 'media', icono: 'verify', titulo: `${plural(sinCruzada.length, 'solicitud espera', 'solicitudes esperan')} prueba cruzada`,
      detalle: 'Hay unidades reservadas sin prueba cruzada registrada.', href: '/laboratorio/compatibilidad', accion: 'Registrar cruzadas',
    });
  }
  if (rol === 'operador') {
    const listas = lista.filter((t) => t.estado === 'aprobado' && !t.faltaParaDespachar);
    if (listas.length) out.push({
      id: 'listas-despacho', nivel: listas.some((t) => t.prioridad !== 'normal') ? 'alta' : 'media', icono: 'truck',
      titulo: `${plural(listas.length, 'transfusión lista', 'transfusiones listas')} para despachar`,
      detalle: 'El laboratorio dejó la compatibilidad conforme.', href: '/operador/entregas', accion: 'Despachar',
    });
  }
  return out;
}

// ------------------------------------------------------------------ Equipos de frío (laboratorio y dirección)
async function equipos(rol: Role): Promise<Aviso[]> {
  const { listarEquipos, alertaDe, fmtTemp } = await import('./equipos');
  const l = await listarEquipos();
  const href = `/${rol}/equipos`;
  const out: Aviso[] = [];
  const fuera = l.filter((e) => alertaDe(e) === 'fuera');
  if (fuera.length) out.push({
    id: 'eq-fuera', nivel: 'alta', icono: 'alert', titulo: `${plural(fuera.length, 'equipo fuera', 'equipos fuera')} de rango de temperatura`,
    detalle: fuera.slice(0, 2).map((e) => `${e.nombre}: ${fmtTemp(e.ultima?.temperatura)}`).join(' · '), href, accion: 'Revisar equipos',
  });
  const sin = l.filter((e) => alertaDe(e) === 'sin_lectura');
  if (sin.length) out.push({
    id: 'eq-sin-lectura', nivel: 'media', icono: 'clock', titulo: `${plural(sin.length, 'equipo', 'equipos')} sin lectura en 12 horas`,
    detalle: sin.slice(0, 3).map((e) => e.nombre).join(' · '), href, accion: 'Registrar lectura',
  });
  const cal = l.filter((e) => alertaDe(e) === 'calibracion');
  if (cal.length) out.push({
    id: 'eq-calibracion', nivel: 'info', icono: 'settings', titulo: `${plural(cal.length, 'equipo con calibración vencida', 'equipos con calibración vencida')}`,
    detalle: cal.slice(0, 3).map((e) => e.nombre).join(' · '), href, accion: 'Ver equipos',
  });
  return out;
}

// ------------------------------------------------------------------ Por rol
async function operador(): Promise<Aviso[]> {
  const out: Aviso[] = [];
  const { getPorVerificar, getPedidosPorDespachar } = await import('./operador');
  const pv = getPorVerificar().length;
  if (pv) out.push({
    id: 'por-verificar', nivel: 'media', icono: 'verify', titulo: `${plural(pv, 'donante espera', 'donantes esperan')} verificación de identidad`,
    detalle: 'Confirma la cédula física la próxima vez que venga al centro.', href: '/operador/donantes', accion: 'Ver donantes',
  });
  if (!usaSupabase()) {
    const pd = getPedidosPorDespachar().length;
    if (pd) out.push({
      id: 'por-despachar', nivel: 'media', icono: 'truck', titulo: `${plural(pd, 'solicitud', 'solicitudes')} por despachar`,
      detalle: 'Tienen unidades reservadas.', href: '/operador/entregas', accion: 'Despachar',
    });
  }
  const citas = await fuente(async () => {
    const { abiertasHoy, bandejaCitas } = await import('./citas');
    const n = abiertasHoy(await bandejaCitas(0));
    return n ? [{
      id: 'citas-hoy', nivel: 'info' as Nivel, icono: 'calendar' as IconKey, titulo: `${plural(n, 'cita abierta', 'citas abiertas')} hoy`,
      detalle: 'Donantes por llegar o en espera de atención.', href: '/operador/citas', accion: 'Abrir bandeja',
    }] : [];
  });
  return out.concat(citas);
}

async function laboratorio(): Promise<Aviso[]> {
  const { kpisLab } = await import('./laboratorio');
  const k = kpisLab();
  const out: Aviso[] = [];
  if (k.positivosSinNotificar) out.push({
    id: 'positivos', nivel: 'alta', icono: 'alert', titulo: `${plural(k.positivosSinNotificar, 'caso positivo', 'casos positivos')} sin notificar`,
    detalle: 'Notifícalos al ente de salud y deja la referencia.', href: '/laboratorio/positivos', accion: 'Notificar',
  });
  if (k.porAnalizar) out.push({
    id: 'por-analizar', nivel: 'media', icono: 'flask', titulo: `${plural(k.porAnalizar, 'donación espera', 'donaciones esperan')} tamizaje`,
    detalle: 'Bolsas en cuarentena hasta que registres las pruebas.', href: '/laboratorio/pruebas', accion: 'Registrar pruebas',
  });
  if (k.porFraccionar) out.push({
    id: 'por-fraccionar', nivel: 'info', icono: 'layers', titulo: `${plural(k.porFraccionar, 'bolsa liberada', 'bolsas liberadas')} por fraccionar`,
    detalle: 'Ya pasaron el tamizaje.', href: '/laboratorio/fraccionamiento', accion: 'Fraccionar',
  });
  return out;
}

async function soporte(): Promise<Aviso[]> {
  const { getTickets } = await import('./soporte');
  const abiertos = getTickets().filter((t) => t.estado !== 'resuelto');
  const out: Aviso[] = [];
  const urgentes = abiertos.filter((t) => t.prioridad === 'alta' && !t.asignadoA);
  if (urgentes.length) out.push({
    id: 'urgentes', nivel: 'alta', icono: 'inbox', titulo: `${plural(urgentes.length, 'solicitud urgente', 'solicitudes urgentes')} sin asignar`,
    detalle: urgentes.slice(0, 2).map((t) => `${t.codigo} · ${t.asunto}`).join(' · '), href: '/soporte/tickets', accion: 'Tomar casos',
  });
  const personal = abiertos.filter((t) => t.donanteId.startsWith('personal:'));
  const inc = await fuente(async () => {
    const { listarIncidencias } = await import('./administracion');
    const r = await listarIncidencias({ estado: 'activas' }, null, 1);
    return r.resumen.criticas ? [{
      id: 'incidencias', nivel: 'alta' as Nivel, icono: 'alert' as IconKey, titulo: `${plural(r.resumen.criticas, 'incidencia alta o crítica', 'incidencias altas o críticas')} sin cerrar`,
      detalle: `${r.resumen.abiertas} abiertas y ${r.resumen.enProceso} en proceso en total.`, href: '/soporte/incidencias', accion: 'Ver incidencias',
    }] : [];
  });
  out.push(...inc);
  if (personal.length) out.push({
    id: 'personal', nivel: 'media', icono: 'users', titulo: `${plural(personal.length, 'reporte del personal', 'reportes del personal')} abiertos`,
    detalle: 'Problemas de la plataforma reportados por operadores, laboratorio o dirección.', href: '/soporte/tickets', accion: 'Atender',
  });
  const dia = 86400000;
  const sinRespuesta = abiertos.filter((t) => t.mensajes.at(-1)?.autor !== 'soporte' && Date.now() - new Date(t.actualizado).getTime() > dia);
  if (sinRespuesta.length) out.push({
    id: 'sin-respuesta', nivel: 'media', icono: 'clock', titulo: `${plural(sinRespuesta.length, 'solicitud lleva', 'solicitudes llevan')} más de 24 h sin respuesta`,
    detalle: 'La última palabra es del usuario.', href: '/soporte/tickets', accion: 'Responder',
  });
  return out;
}

/** Avisos vigentes del rol, de lo más urgente a lo informativo. */
export async function avisosDe(rol: Role): Promise<Aviso[]> {
  const fuentes: Promise<Aviso[]>[] = [];
  if (rol === 'operador') fuentes.push(fuente(operador), fuente(() => seguridad(rol)), fuente(() => compatibilidad(rol)), fuente(() => pedidosCentros(rol)), fuente(() => hemovigilancia(rol)), fuente(() => inventario('/operador/panel')));
  if (rol === 'laboratorio') fuentes.push(fuente(laboratorio), fuente(() => seguridad(rol)), fuente(() => compatibilidad(rol)), fuente(() => equipos(rol)));
  if (rol === 'director') fuentes.push(fuente(() => pedidosCentros(rol)), fuente(() => hemovigilancia(rol)), fuente(() => inventario('/director/inventario')), fuente(() => equipos(rol)));
  if (rol === 'soporte') fuentes.push(fuente(soporte));
  const todos = (await Promise.all(fuentes)).flat();
  return todos.sort((a, b) => ORDEN[a.nivel] - ORDEN[b.nivel]);
}

/** Cuántos avisos piden acción (urgentes y pendientes): el número del menú. */
export const importantes = (l: Aviso[]) => l.filter((a) => a.nivel !== 'info').length;
