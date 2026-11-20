// src/lib/reportes-pdf.ts
// Un PDF con diseño propio para cada reporte de la dirección, todos sobre el kit de lib/pdf.ts.
// Se carga bajo demanda (import dinámico) para no sumar pdf-lib a la carga inicial de las páginas.

import { getSession } from './auth';
import { nombrePdf, nuevoPdf } from './pdf';
import type { Tono } from './pdf';
import { fmtFechaLarga, fmtNum } from './estadisticas';
import type { Matriz } from './estadisticas';
import type { ReporteDirector } from './director';
import type { PedidoOp } from './db';
import type { Unidad } from './operador';
import { ESTADO_PEDIDO, PRIORIDAD_LABEL } from './operador';
import { ESTADO_PEDIDO_CENTRO } from './centros';
import type { PedidoCentro } from './centros';

const quien = () => {
  const s = (getSession() ?? {}) as Record<string, string>;
  return { nombre: s.name || 'Dirección', sede: s.sede || 'Banco de sangre' };
};
const corta = (iso?: string) => (iso ? new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const hoyLargo = () => fmtFechaLarga(new Date().toISOString().slice(0, 10));

// ------------------------------------------------------------------ 1. Mapa de calor
export async function pdfEstadisticas(m: Matriz, lineas: string[], sedes: number) {
  const q = quien();
  const pdf = await nuevoPdf({
    tipo: 'Estadísticas de donación',
    titulo: 'Donaciones por centro',
    subtitulo: `Mapa de calor de la red · ${fmtFechaLarga(m.desde)} al ${fmtFechaLarga(m.hasta)}`,
    meta: [['Periodo', `${corta(m.desde)} — ${corta(m.hasta)}`], ['Agrupado por', m.agrupacion === 'mes' ? 'Mes' : 'Semana'],
      ['Medida', m.metrica === 'litros' ? 'Litros extraídos' : 'Número de donaciones'], ['Elaborado por', q.nombre], ['Sede', q.sede], ['Fecha', hoyLargo()]],
    horizontal: m.periodos.length > 8,
  });
  const lider = m.filas[0];
  const iPico = m.totalesPeriodo.indexOf(Math.max(0, ...m.totalesPeriodo));
  const v = m.anterior > 0 ? Math.round(((m.total - m.anterior) / m.anterior) * 100) : null;
  pdf.kpis([
    { label: m.metrica === 'litros' ? 'Litros' : 'Donaciones', valor: fmtNum(m.total, m.metrica), nota: v === null ? 'sin periodo previo' : `${v >= 0 ? '+' : '-'}${Math.abs(v)} % vs. periodo anterior`, tono: v === null ? undefined : v >= 0 ? 'ok' : 'rojo' },
    { label: 'Centros activos', valor: `${m.filas.length} de ${sedes}`, nota: 'con al menos una donación' },
    { label: 'Centro líder', valor: lider?.sede ?? '—', nota: lider && m.total ? `${Math.round((lider.total / m.total) * 100)} % del total` : 'sin actividad' },
    { label: 'Periodo pico', valor: m.total ? m.periodos[iPico].label : '—', nota: m.total ? `${fmtNum(m.totalesPeriodo[iPico], m.metrica)}${m.metrica === 'donaciones' ? ' donaciones' : ''}` : '' },
  ]);
  pdf.seccion('Resumen');
  pdf.parrafos(lineas, { vinetas: true });
  pdf.seccion('Mapa de calor', 'centro × periodo');
  if (m.filas.length) {
    pdf.heatmap({
      filas: m.filas.map((f) => f.sede), columnas: m.periodos.map((p) => p.corto),
      valores: m.filas.map((f) => f.celdas), max: m.max, fmt: (n) => fmtNum(n, m.metrica).replace(' L', ''),
    });
  } else pdf.aviso('No se registraron donaciones en el periodo.', 'neutro');
  pdf.seccion('Ranking de centros');
  pdf.tabla(
    [{ titulo: '#', ancho: 0.5, alinear: 'centro' }, { titulo: 'Centro', ancho: 5 }, { titulo: 'Donaciones', ancho: 1.6, alinear: 'der' },
      { titulo: 'Litros', ancho: 1.4, alinear: 'der' }, { titulo: 'Cuota', ancho: 1.2, alinear: 'der' }, { titulo: 'Mejor periodo', ancho: 2, alinear: 'der' }],
    m.filas.map((f, i) => [String(i + 1), f.sede, String(f.donaciones), fmtNum(f.litros, 'litros'),
      m.total ? `${Math.round((f.total / m.total) * 100)} %` : '—', m.periodos[f.pico]?.corto ?? '—']),
    { vacio: 'Sin centros con actividad en el periodo.' },
  );
  await pdf.descargar(nombrePdf('estadisticas-donacion', `${m.desde}_${m.hasta}`));
}

// ------------------------------------------------------------------ 2. Reporte consolidado
export async function pdfConsolidado(r: ReporteDirector) {
  const q = quien();
  const pdf = await nuevoPdf({
    tipo: 'Reporte consolidado',
    titulo: 'Reporte consolidado de la red',
    subtitulo: `Lo registrado por operadores y laboratorio del ${fmtFechaLarga(r.desde)} al ${fmtFechaLarga(r.hasta)}`,
    meta: [['Periodo', `${corta(r.desde)} — ${corta(r.hasta)}`], ['Elaborado por', q.nombre], ['Sede', q.sede]],
  });
  pdf.kpis([
    { label: 'Donaciones', valor: String(r.donaciones), nota: `${(r.volumenMl / 1000).toLocaleString('es-VE', { maximumFractionDigits: 1 })} L extraídos` },
    { label: 'Unidades entregadas', valor: String(r.unidadesEntregadas), nota: `${r.entregasPorDestino.length} destino${r.entregasPorDestino.length === 1 ? '' : 's'}` },
    { label: 'Pruebas de laboratorio', valor: String(r.pruebas), nota: `${r.descartadas} bolsas descartadas`, tono: r.descartadas ? 'aviso' : undefined },
    { label: 'Donantes nuevos', valor: String(r.donantesNuevos), nota: 'registrados en el periodo' },
  ]);
  const orden = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  pdf.seccion('Donaciones por tipo de sangre');
  pdf.barras(orden(r.donacionesPorTipo));
  pdf.seccion('Donaciones por hemocomponente');
  pdf.barras(orden(r.donacionesPorComponente));
  pdf.seccion('Unidades entregadas por destino');
  pdf.barras(r.entregasPorDestino.map((d) => ({ k: d.destino, v: d.unidades })));
  pdf.seccion('Solicitudes por estado');
  pdf.barras(orden(r.solicitudesPorEstado));
  pdf.aviso('El detalle de los casos reactivos (qué prueba y de quién) solo lo ve el laboratorio, por confidencialidad del donante.', 'neutro');
  pdf.firmas(['Elaborado por', 'Director(a) del banco de sangre']);
  await pdf.descargar(nombrePdf('reporte-consolidado', `${r.desde}_${r.hasta}`));
}

// ------------------------------------------------------------------ 3. Inventario
export async function pdfInventario(unidades: Unidad[], filtros: string, resumen: { vigentes: number; porVencer: number; vencidas: number; cuarentena: number }) {
  const q = quien();
  const pdf = await nuevoPdf({
    tipo: 'Inventario de hemocomponentes',
    titulo: 'Inventario de hemocomponentes',
    subtitulo: 'Unidades liberadas por el laboratorio, ordenadas por vencimiento (sale primero lo que vence antes).',
    meta: [['Corte al', hoyLargo()], ['Filtros', filtros || 'Ninguno'], ['Elaborado por', q.nombre]],
  });
  pdf.kpis([
    { label: 'Vigentes', valor: String(resumen.vigentes), nota: 'unidades disponibles', tono: 'ok' },
    { label: 'Por vencer', valor: String(resumen.porVencer), nota: 'en 7 días o menos', tono: resumen.porVencer ? 'aviso' : undefined },
    { label: 'Vencidas', valor: String(resumen.vencidas), nota: 'por retirar del stock', tono: resumen.vencidas ? 'rojo' : undefined },
    { label: 'En cuarentena', valor: String(resumen.cuarentena), nota: 'esperan al laboratorio' },
  ]);
  if (resumen.vencidas) pdf.aviso(`Hay ${resumen.vencidas} unidad(es) vencidas en el stock: deben retirarse y descartarse según el procedimiento del banco.`, 'rojo');
  pdf.seccion('Unidades', `${unidades.length} en el listado`);
  const estado = (u: Unidad): { texto: string; tono: Tono } =>
    u.estado === 'vencida' ? { texto: 'Vencida', tono: 'rojo' } : u.estado === 'por_vencer' ? { texto: u.dias === 0 ? 'Vence hoy' : `Vence en ${u.dias} d`, tono: 'aviso' } : { texto: 'Disponible', tono: 'ok' };
  pdf.tabla(
    [{ titulo: 'Bolsa', ancho: 2.6, mono: true }, { titulo: 'Componente', ancho: 3 }, { titulo: 'Tipo', ancho: 0.9, alinear: 'centro' },
      { titulo: 'Extracción', ancho: 1.6 }, { titulo: 'Vence', ancho: 1.6 }, { titulo: 'Estado', ancho: 1.6 }],
    unidades.map((u) => [u.codigo, u.componente, u.tipoSangre, corta(u.extraccion), corta(u.vence), estado(u)]),
    { vacio: 'No hay unidades con esos filtros.' },
  );
  pdf.firmas(['Responsable de inventario', 'Director(a)']);
  await pdf.descargar(nombrePdf('inventario'));
}

// ------------------------------------------------------------------ 4. Solicitudes
const tonoEstado: Record<string, Tono> = { pendiente: 'aviso', aprobado: 'ok', rechazado: 'rojo', despachado: 'neutro' };

export async function pdfSolicitudes(lista: PedidoOp[], filtro: string) {
  const q = quien();
  const pdf = await nuevoPdf({
    tipo: 'Solicitudes de hemocomponentes',
    titulo: 'Solicitudes de hemocomponentes',
    subtitulo: `Listado: ${filtro}`,
    meta: [['Fecha', hoyLargo()], ['Solicitudes', String(lista.length)], ['Elaborado por', q.nombre]],
    horizontal: true,
  });
  const n = (e: string) => lista.filter((p) => p.estado === e).length;
  pdf.kpis([
    { label: 'En espera de stock', valor: String(n('pendiente')), tono: n('pendiente') ? 'aviso' : undefined },
    { label: 'Reservadas', valor: String(n('aprobado')), tono: 'ok' },
    { label: 'Despachadas', valor: String(n('despachado')) },
    { label: 'Anuladas', valor: String(n('rechazado')), tono: n('rechazado') ? 'rojo' : undefined },
  ]);
  pdf.tabla(
    [{ titulo: 'Folio', ancho: 1.3, mono: true }, { titulo: 'Fecha', ancho: 1.2 }, { titulo: 'Pedido', ancho: 3 }, { titulo: 'Paciente', ancho: 2.4 },
      { titulo: 'Hospital', ancho: 2.6 }, { titulo: 'Prioridad', ancho: 1.1 }, { titulo: 'Estado', ancho: 1.5 }],
    lista.map((p) => [p.id.replace(/^REQ-0*/, 'REQ-'), corta(p.fecha), `${p.unidades} u. ${p.tipoSangre} · ${p.tipoHemocomponente}`, p.pacienteNombre, p.hospitalDestino,
      { texto: PRIORIDAD_LABEL[p.prioridad ?? 'normal'], tono: p.prioridad === 'critica' ? 'rojo' : p.prioridad === 'urgente' ? 'aviso' : 'neutro' },
      { texto: ESTADO_PEDIDO[p.estado], tono: tonoEstado[p.estado] }]),
    { vacio: 'No hay solicitudes con esos filtros.' },
  );
  await pdf.descargar(nombrePdf('solicitudes'));
}

/** Comprobante de una solicitud de transfusión local: reserva, compatibilidad y despacho, con firmas. */
export async function pdfSolicitud(p: PedidoOp, folio: string) {
  const pdf = await nuevoPdf({
    tipo: 'Comprobante de solicitud',
    titulo: `Solicitud ${folio}`,
    subtitulo: `${p.unidades} u. ${p.tipoSangre} · ${p.tipoHemocomponente} para ${p.hospitalDestino}`,
    meta: [['Estado', ESTADO_PEDIDO[p.estado]], ['Prioridad', PRIORIDAD_LABEL[p.prioridad ?? 'normal']], ['Fecha', corta(p.fecha)],
      ['Registrada por', p.creadoPorNombre ?? '—'], ['Hospital', p.hospitalDestino], ['Anulada por', p.estado === 'rechazado' ? (p.revisadoPorNombre ?? '—') : '—']],
  });
  if (p.estado === 'rechazado' && p.motivoRechazo) pdf.aviso(`Motivo de la anulación: ${p.motivoRechazo}`, 'rojo');
  if (p.estado === 'pendiente') pdf.aviso('En espera de stock: aún no hay unidades reservadas en la sede.', 'aviso');
  pdf.seccion('Paciente');
  pdf.fichas([['Nombre', p.pacienteNombre], ['Cédula', p.pacienteCedula || '—'], ['Servicio', p.servicio ?? '—'], ['Médico solicitante', p.medico ?? '—'], ['Diagnóstico', p.diagnostico ?? '—']]);
  pdf.seccion('Pedido');
  pdf.fichas([['Hemocomponente', p.tipoHemocomponente], ['Tipo de sangre', p.tipoSangre], ['Unidades', String(p.unidades)], ['Hospital', p.hospitalDestino]]);
  const clin = Object.entries(p.clinica ?? {}).filter(([k, v]) => v && k !== 'consentimiento');
  if (clin.length) { pdf.seccion('Laboratorio del paciente'); pdf.fichas(clin.map(([k, v]) => [k, String(v)]), 3); }
  pdf.firmas(['Laboratorio (compatibilidad)', 'Operador que despacha', 'Recibe en el servicio']);
  await pdf.descargar(nombrePdf(`solicitud-${folio}`));
}

// ------------------------------------------------------------------ 4b. Pedidos entre centros
const tonoCentro: Record<string, Tono> = { pendiente: 'aviso', aprobada: 'ok', rechazada: 'rojo', despachada: 'neutro', recibida: 'ok', cancelada: 'neutro' };

export async function pdfPedidosCentros(lista: PedidoCentro[], titulo: string, centro: string) {
  const q = quien();
  const pdf = await nuevoPdf({
    tipo: 'Pedidos entre centros',
    titulo,
    subtitulo: centro ? `Centro: ${centro}` : undefined,
    meta: [['Fecha', hoyLargo()], ['Pedidos', String(lista.length)], ['Elaborado por', q.nombre]],
    horizontal: true,
  });
  const n = (e: string) => lista.filter((p) => p.estado === e).length;
  pdf.kpis([
    { label: 'Por aprobar', valor: String(n('pendiente')), tono: n('pendiente') ? 'aviso' : undefined },
    { label: 'Aprobados', valor: String(n('aprobada')), tono: 'ok' },
    { label: 'En camino', valor: String(n('despachada')) },
    { label: 'Recibidos', valor: String(n('recibida')) },
  ]);
  pdf.tabla(
    [{ titulo: 'Folio', ancho: 1.2, mono: true }, { titulo: 'Fecha', ancho: 1.2 }, { titulo: 'Pedido', ancho: 2.8 }, { titulo: 'Solicitante', ancho: 2.4 },
      { titulo: 'Proveedor', ancho: 2.4 }, { titulo: 'Prioridad', ancho: 1.1 }, { titulo: 'Estado', ancho: 1.3 }],
    lista.map((p) => [p.id, corta(p.fecha), `${p.unidades} u. ${p.tipoSangre} · ${p.componente}`, p.solicitante.nombre, p.proveedora.nombre,
      { texto: PRIORIDAD_LABEL[p.prioridad], tono: p.prioridad === 'critica' ? 'rojo' : p.prioridad === 'urgente' ? 'aviso' : 'neutro' },
      { texto: ESTADO_PEDIDO_CENTRO[p.estado], tono: tonoCentro[p.estado] }]),
    { vacio: 'No hay pedidos.' },
  );
  await pdf.descargar(nombrePdf('pedidos-entre-centros'));
}

/** Comprobante de un pedido entre centros: acompaña a las bolsas en el traslado. */
export async function pdfPedidoCentro(p: PedidoCentro) {
  const pdf = await nuevoPdf({
    tipo: 'Pedido entre centros',
    titulo: `Pedido ${p.id}`,
    subtitulo: `${p.unidades} u. ${p.tipoSangre} · ${p.componente} de ${p.proveedora.nombre} para ${p.solicitante.nombre}`,
    meta: [['Estado', ESTADO_PEDIDO_CENTRO[p.estado]], ['Prioridad', PRIORIDAD_LABEL[p.prioridad]], ['Fecha', corta(p.fecha)],
      ['Pedido por', p.creadoPor ?? '—'], ['Resuelto por', p.revisadoPor ?? '—'], ['Resolución', corta(p.revisadoEn)]],
  });
  if (p.estado === 'rechazada' && p.motivoRechazo) pdf.aviso(`Motivo del rechazo: ${p.motivoRechazo}`, 'rojo');
  pdf.seccion('Centros');
  pdf.fichas([['Centro solicitante', p.solicitante.nombre], ['Centro proveedor', p.proveedora.nombre], ['Motivo', p.motivo], ['Solicitud del paciente', p.solicitudLocal ?? '—']]);
  pdf.seccion('Unidades');
  if (p.bolsas?.length) {
    pdf.tabla([{ titulo: 'Bolsa', ancho: 2, mono: true }, { titulo: 'Componente', ancho: 2.4 }, { titulo: 'Tipo', ancho: 1, alinear: 'centro' }, { titulo: 'Vence', ancho: 1.4 }],
      p.bolsas.map((b) => [b.codigo, p.componente, p.tipoSangre, corta(b.vence)]));
  } else pdf.fichas([['Componente', p.componente], ['Tipo de sangre', p.tipoSangre], ['Unidades', String(p.unidades)]], 3);
  pdf.firmas(['Director(a) del centro proveedor', 'Operador que despacha', 'Recibe en el centro solicitante']);
  await pdf.descargar(nombrePdf(`pedido-${p.id}`));
}

// ------------------------------------------------------------------ 5. Hemovigilancia
export interface ReporteHV {
  id: string; din: string; fecha: string; enCurso: boolean; tipoEvento: string; categoria: string; severidad: string;
  componente: string; volumen: string; centroOrigen: string; centrifugado?: string;
  infusion: { inicio: string; transicion: string; finalizacion: string; goteo: string };
  donante: { nombre: string; cedula: string; tipoDonacion: string };
  paciente: { nombre: string; cedula: string; ubicacion: string; medico: string };
  preTransfucion: { consentimiento: boolean; dobleChequeo: boolean; coombs: string; pruebaCruzada: string };
  signosVitales: { pa: string; temp: string; fc: string };
  acciones: string;
}

export async function pdfHemovigilancia(r: ReporteHV) {
  const sev: Tono = r.severidad === 'Crítica' ? 'rojo' : r.severidad === 'Urgente' ? 'aviso' : 'neutro';
  const pdf = await nuevoPdf({
    tipo: 'Hemovigilancia · trazabilidad',
    titulo: `Reporte ${r.id}`,
    subtitulo: `${r.tipoEvento} · ${r.categoria}`,
    meta: [['Fecha del evento', r.fecha], ['Severidad', r.severidad], ['Estado', r.enCurso ? 'En curso' : 'Cerrado'],
      ['DIN de la bolsa', r.din], ['Componente', `${r.componente} · ${r.volumen}`], ['Centro', r.centroOrigen]],
  });
  pdf.aviso(`Severidad ${r.severidad.toLowerCase()}${r.enCurso ? ': el evento sigue en curso.' : '.'}`, sev);
  pdf.seccion('Paciente receptor');
  pdf.fichas([['Nombre', r.paciente.nombre], ['Cédula', r.paciente.cedula], ['Ubicación', r.paciente.ubicacion], ['Médico responsable', r.paciente.medico]]);
  pdf.seccion('Controles previos a la transfusión');
  pdf.tabla([{ titulo: 'Control', ancho: 3 }, { titulo: 'Resultado', ancho: 2 }], [
    ['Consentimiento informado', { texto: r.preTransfucion.consentimiento ? 'Firmado' : 'No consta', tono: r.preTransfucion.consentimiento ? 'ok' : 'rojo' }],
    ['Doble verificación en cabecera', { texto: r.preTransfucion.dobleChequeo ? 'Realizada' : 'No consta', tono: r.preTransfucion.dobleChequeo ? 'ok' : 'rojo' }],
    ['Coombs', { texto: r.preTransfucion.coombs, tono: r.preTransfucion.coombs === 'Negativo' ? 'ok' : 'neutro' }],
    ['Prueba cruzada', { texto: r.preTransfucion.pruebaCruzada, tono: r.preTransfucion.pruebaCruzada === 'Compatible' ? 'ok' : 'neutro' }],
  ]);
  pdf.seccion('Infusión y signos vitales');
  pdf.fichas([['Inicio', r.infusion.inicio], ['Transición', r.infusion.transicion], ['Finalización', r.infusion.finalizacion], ['Goteo', r.infusion.goteo],
    ['Presión arterial', r.signosVitales.pa], ['Temperatura', r.signosVitales.temp], ['Frecuencia cardíaca', r.signosVitales.fc], ['Procesamiento', r.centrifugado ?? '—']]);
  pdf.seccion('Donante de la unidad');
  pdf.fichas([['Nombre', r.donante.nombre], ['Cédula', r.donante.cedula], ['Tipo de donación', r.donante.tipoDonacion]], 3);
  pdf.seccion('Acciones tomadas');
  pdf.parrafos([r.acciones.replace(/\[cite:[^\]]*\]/g, '')]);
  pdf.firmas(['Médico responsable', 'Hemovigilancia', 'Director(a)']);
  await pdf.descargar(nombrePdf(`hemovigilancia-${r.id}`));
}

// ------------------------------------------------------------------ 6. Personal
export interface CuentaPdf { name: string; email: string; role: string; cargo?: string; sede?: string; activo: boolean; acciones?: number }
const ROL: Record<string, string> = { operador: 'Operador', laboratorio: 'Laboratorio', soporte: 'Soporte', director: 'Dirección', donante: 'Donante' };

export async function pdfPersonal(cuentas: CuentaPdf[]) {
  const q = quien();
  const pdf = await nuevoPdf({
    tipo: 'Personal',
    titulo: 'Cuentas del personal',
    subtitulo: 'Quién tiene acceso a la plataforma y con qué rol.',
    meta: [['Fecha', hoyLargo()], ['Cuentas', String(cuentas.length)], ['Elaborado por', q.nombre]],
  });
  const por = (r: string) => cuentas.filter((c) => c.role === r).length;
  pdf.kpis([
    { label: 'Operadores', valor: String(por('operador')) }, { label: 'Laboratorio', valor: String(por('laboratorio')) },
    { label: 'Soporte', valor: String(por('soporte')) }, { label: 'Dirección', valor: String(por('director')) },
  ]);
  pdf.tabla(
    [{ titulo: 'Nombre', ancho: 2.6 }, { titulo: 'Correo', ancho: 3 }, { titulo: 'Rol', ancho: 1.3 }, { titulo: 'Cargo', ancho: 2 }, { titulo: 'Sede', ancho: 2.4 }, { titulo: 'Estado', ancho: 1.3 }],
    cuentas.map((c) => [c.name, c.email, ROL[c.role] ?? c.role, c.cargo ?? '—', c.sede ?? '—', { texto: c.activo ? 'Activa' : 'Desactivada', tono: c.activo ? 'ok' : 'rojo' }]),
  );
  await pdf.descargar(nombrePdf('personal'));
}

/** Constancia de acceso para entregar a la persona al crear su cuenta. */
export async function pdfConstanciaAcceso(c: CuentaPdf & { clave: string }) {
  const q = quien();
  const pdf = await nuevoPdf({
    tipo: 'Constancia de acceso',
    titulo: 'Bienvenida a BLUD',
    subtitulo: `${c.name}, esta es tu cuenta para entrar a la plataforma del banco de sangre.`,
    meta: [['Rol', ROL[c.role] ?? c.role], ['Sede', c.sede ?? '—'], ['Emitida por', q.nombre]],
  });
  pdf.seccion('Datos de acceso');
  pdf.fichas([['Correo', c.email], ['Clave temporal', c.clave], ['Dirección de acceso', `${location.origin}/login`], ['Cargo', c.cargo ?? '—']]);
  pdf.aviso('Cambia la clave temporal la primera vez que entres (Configuración > Seguridad) y activa la verificación en dos pasos. No compartas este documento.', 'aviso');
  pdf.seccion('Qué puedes hacer');
  const que: Record<string, string[]> = {
    operador: ['Atender las citas del centro, verificar donantes y registrar evaluaciones y extracciones.', 'Registrar solicitudes de transfusión y despachar las unidades listas.'],
    laboratorio: ['Registrar el tamizaje de cada donación, fraccionar y liberar unidades.', 'Hacer el tipaje y las pruebas cruzadas antes de cada transfusión.'],
    soporte: ['Atender la bandeja de solicitudes de los donantes y conversar con ellos.', 'Consultar donantes en solo lectura.'],
    director: ['Supervisar el inventario, los reportes y la hemovigilancia de la red.', 'Aprobar las solicitudes de hemocomponentes entre centros.'],
  };
  pdf.parrafos(que[c.role] ?? [], { vinetas: true });
  pdf.firmas(['Entrega (dirección)', 'Recibe']);
  await pdf.descargar(nombrePdf(`acceso-${c.email.split('@')[0]}`));
}
