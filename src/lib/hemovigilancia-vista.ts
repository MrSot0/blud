// src/lib/hemovigilancia-vista.ts
// HTML de solo lectura de un registro de hemovigilancia (operador con el registro cerrado y dirección).

import { TIPO_EVENTO, alertasTiempo, duracionMin, esGrave, fmtFechaHora, tonoSeveridad } from './hemovigilancia';
import type { RegistroHV, Signos } from './hemovigilancia';
import { esc } from './ui';

export function chipEvento(r: RegistroHV): string {
  if (!r.tipoEvento) return '<span class="whitespace-nowrap rounded-full bg-sunken px-2.5 py-0.5 text-xs font-bold text-ink-2">En curso</span>';
  if (r.tipoEvento === 'sin_reaccion') return '<span class="whitespace-nowrap rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-bold text-ok">Sin reacción</span>';
  return `<span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${tonoSeveridad(r.severidad)}">${esc(TIPO_EVENTO[r.tipoEvento])}${r.severidad ? ' · ' + esc(r.severidad) : ''}</span>`;
}

export const chipEstadoHV = (r: RegistroHV) =>
  r.estado === 'cerrado'
    ? '<span class="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-bold text-ink-2">Cerrado</span>'
    : '<span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-bold text-warn"><span class="size-1.5 rounded-full bg-warn" aria-hidden="true"></span>En curso</span>';

const dato = (k: string, v?: string | number | null) =>
  `<div><dt class="text-[0.6875rem] font-bold uppercase tracking-wide text-ink-3">${esc(k)}</dt><dd class="mt-0.5 text-sm font-semibold text-ink">${v === undefined || v === null || v === '' ? '—' : esc(v)}</dd></div>`;

const bloque = (titulo: string, cuerpo: string) =>
  `<section class="space-y-3"><h3 class="border-b border-line pb-1.5 text-xs font-bold uppercase tracking-wider text-ink-2">${esc(titulo)}</h3>${cuerpo}</section>`;

const control = (t: string, ok: boolean) =>
  `<li class="flex items-center justify-between gap-3 py-2 text-sm"><span class="text-ink-2">${esc(t)}</span>
    <span class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${ok ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent-ink'}">${ok ? 'Conforme' : 'No consta'}</span></li>`;

const celda = (s: Signos | undefined, k: keyof Signos, suf = '') => (s?.[k] ? esc(s[k]) + suf : '<span class="text-ink-3">—</span>');

export function detalleHTML(r: RegistroHV): string {
  const dur = duracionMin(r);
  const v = r.verificacion;
  const filas: [string, Signos | undefined][] = [['Antes', r.signos.antes], ['15 min', r.signos.durante], ['Al terminar', r.signos.despues]];
  const evento = r.tipoEvento && r.tipoEvento !== 'sin_reaccion';
  return `
    ${esGrave(r) ? `<p class="rounded-control bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-ink">Evento grave: notifícalo a la dirección y conserva la bolsa y las muestras para el estudio.</p>` : ''}
    ${bloque('Paciente y unidad', `<dl class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      ${dato('Paciente', r.paciente?.nombre)}${dato('Cédula', r.paciente?.cedula)}${dato('Historia', r.paciente?.historia)}
      ${dato('Ubicación', r.ubicacion)}${dato('Médico', r.medico)}${dato('Sede', r.sede?.nombre)}
      ${dato('Unidad', r.unidadCodigo ?? String(r.unidadId))}${dato('Componente', r.componente)}${dato('Grupo', r.tipoSangre)}
    </dl>`)}
    ${bloque('Doble verificación', `<ul class="divide-y divide-line">
      ${control('Identidad del paciente', v.identidad)}${control('Grupo ABO/Rh compatible', v.grupo)}
      ${control('Etiqueta, DIN y vencimiento', v.etiqueta)}${control('Consentimiento firmado', v.consentimiento)}${control('Orden médica escrita', !!v.ordenMedica)}
    </ul><p class="text-sm text-ink-2">Segundo verificador: <strong class="text-ink">${esc(v.segundoVerificador || '—')}</strong></p>`)}
    ${bloque('Infusión', `<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      ${dato('Inicio', fmtFechaHora(r.inicio))}${dato('Fin', fmtFechaHora(r.fin))}${dato('Duración', dur === null ? null : `${dur} min`)}${dato('Volumen', r.volumenMl ? `${r.volumenMl} ml` : null)}
      ${dato('Velocidad', r.velocidad)}${dato('Despachada', r.despachado && r.despachado.length > 10 ? fmtFechaHora(r.despachado) : null)}
    </dl>${alertasTiempo(r).map((a) => `<p class="rounded-control bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">${esc(a)}</p>`).join('')}`)}
    ${bloque('Signos vitales', `<div class="overflow-x-auto"><table class="w-full min-w-[26rem] text-sm tabular">
      <thead class="text-left text-[0.6875rem] uppercase text-ink-3"><tr><th class="py-1.5 pr-2"></th><th class="py-1.5 pr-2">PA</th><th class="py-1.5 pr-2">FC</th><th class="py-1.5 pr-2">Temp.</th><th class="py-1.5 pr-2">FR</th><th class="py-1.5">SpO2</th></tr></thead>
      <tbody class="divide-y divide-line">${filas.map(([n, s]) => `<tr><th class="py-2 pr-2 text-left font-semibold text-ink-2">${n}</th>
        <td class="py-2 pr-2">${celda(s, 'pa')}</td><td class="py-2 pr-2">${celda(s, 'fc')}</td><td class="py-2 pr-2">${celda(s, 'temp', ' °C')}</td><td class="py-2 pr-2">${celda(s, 'fr')}</td><td class="py-2">${celda(s, 'spo2', ' %')}</td></tr>`).join('')}</tbody>
    </table></div>`)}
    ${bloque('Resultado', `<p>${chipEvento(r)}</p>${evento ? `<dl class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      ${dato('Categoría', r.categoria)}${dato('Severidad', r.severidad)}${dato('Imputabilidad', r.imputabilidad)}</dl>
      ${r.sintomas ? `<div><p class="text-[0.6875rem] font-bold uppercase tracking-wide text-ink-3">Signos y síntomas</p><p class="mt-0.5 whitespace-pre-wrap text-sm text-ink">${esc(r.sintomas)}</p></div>` : ''}
      <div><p class="text-[0.6875rem] font-bold uppercase tracking-wide text-ink-3">Acciones tomadas</p><p class="mt-0.5 whitespace-pre-wrap text-sm text-ink">${esc(r.acciones || '—')}</p></div>` : ''}`)}
    ${r.devolucion ? bloque('Devolución de la bolsa', `<dl class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      ${dato('Devuelta', `${fmtFechaHora(r.devolucion.fecha)}${r.devolucion.por ? ' · ' + r.devolucion.por : ''}`)}
      ${dato('Recibida por el laboratorio', r.devolucion.recibidaEn ? `${fmtFechaHora(r.devolucion.recibidaEn)}${r.devolucion.recibidaPor ? ' · ' + r.devolucion.recibidaPor : ''}` : 'Pendiente')}
      ${r.devolucion.notaRecepcion ? dato('Nota de recepción', r.devolucion.notaRecepcion) : ''}</dl>
      <p class="whitespace-pre-wrap text-sm text-ink">${esc(r.devolucion.motivo)}</p>`) : ''}
    ${evento ? bloque('Comité de hemovigilancia', r.comite
      ? `<p class="text-sm text-ink">Notificado el ${esc(fmtFechaHora(r.comite.fecha))}${r.comite.por ? ` por ${esc(r.comite.por)}` : ''}.</p>${r.comite.nota ? `<p class="whitespace-pre-wrap text-sm text-ink-2">${esc(r.comite.nota)}</p>` : ''}`
      : '<p class="text-sm text-ink-2">Todavía no se notifica al comité. Lo hace la dirección de la sede.</p>') : ''}
    <p class="text-xs text-ink-3">Registrado por ${esc(r.registradoPor ?? '—')} el ${esc(fmtFechaHora(r.registrado))}${r.actualizado && r.actualizado !== r.registrado ? ` · última modificación ${esc(fmtFechaHora(r.actualizado))}` : ''}.</p>`;
}
