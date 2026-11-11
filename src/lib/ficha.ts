// src/lib/ficha.ts
// Ficha del donante para el personal: la usan /verificar (QR escaneado) y Operador → Donantes.
// Con base real la entrega blud_donante_ficha() (solo roles del personal); en modo demo sale del registro local.

import { buscarRegistro, donaciones, normCedula, type RegistroDonante } from './db';
import { sb, usaSupabase } from './supabase';
import { edadDe, fmtFecha } from './donante';

export interface Ficha {
  id: string;
  nombres?: string;
  apellidos?: string;
  cedula?: string;
  telefono?: string;
  email?: string;
  nacimiento?: string;
  sexo?: string;
  sangre?: string;
  registrado?: string;
  verificado?: boolean;
  /** Ruta en el bucket fotos-donantes (base real) o data URL (demo). */
  foto?: string;
  donaciones?: number;
  ultimaDonacion?: string;
  proximaCita?: { centro: string; date: string; time: string };
  direccion?: string;
  ocupacion?: string;
  contactoEmergencia?: { nombre?: string; telefono?: string; parentesco?: string };
  proximaDonacion?: string;
  diferimiento?: { tipo: 'temporal' | 'permanente'; origen: 'evaluacion' | 'laboratorio'; desde?: string; hasta?: string; sede?: string };
  contactoPendiente?: boolean;
  cuestionario?: { fecha: string; apto: boolean; alertas: { pregunta: string; motivo: string }[]; respuestas?: { id: number; pregunta: string; respuesta: string; alerta: boolean }[] };
}

/** Próxima cita del donante en el libro de citas de este navegador (modo demo). */
function citaLocal(email?: string): Ficha['proximaCita'] {
  if (!email) return undefined;
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    const book = JSON.parse(localStorage.getItem('blud-appointments') || '{}') as Record<string, { centerName: string; date: string; time: string }[]>;
    const c = (book[email.toLowerCase()] ?? [])
      .filter((a) => a.date >= hoy)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
    return c ? { centro: c.centerName, date: c.date, time: c.time } : undefined;
  } catch {
    return undefined;
  }
}

const sumar = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Ficha armada con el registro local (y con el perfil, si el donante usa este mismo navegador). */
export function fichaDeRegistro(r: RegistroDonante): Ficha {
  let perfil: Record<string, string> = {};
  try { perfil = JSON.parse(localStorage.getItem('blud-donor') || '{}'); } catch {}
  const mismo = perfil.id === r.id || (!!perfil.cedula && normCedula(perfil.cedula) === r.cedula);
  const [nombres, ...resto] = r.nombreCompleto.split(/\s+/);
  const dons = donaciones.all()
    .filter((d) => d.donanteId === r.id || normCedula(d.donanteCedula) === r.cedula)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  return {
    id: r.id,
    nombres: mismo ? perfil.firstname : nombres,
    apellidos: mismo ? perfil.lastname : resto.join(' '),
    cedula: r.cedula, telefono: r.telefono, email: r.email, nacimiento: r.nacimiento, sexo: r.sexo, sangre: r.sangre,
    registrado: r.fechaRegistro, verificado: r.estado === 'verificado', foto: mismo ? perfil.foto : undefined,
    donaciones: dons.length, ultimaDonacion: dons[0]?.fecha, proximaCita: citaLocal(r.email),
    // Lo que solo existe en el perfil de este navegador (modo demo).
    direccion: mismo ? perfil.direccion : undefined,
    ocupacion: mismo ? perfil.ocupacion : undefined,
    contactoEmergencia: mismo ? (perfil as unknown as { contacto?: Ficha['contactoEmergencia'] }).contacto : undefined,
    cuestionario: mismo ? (perfil as unknown as { cuestionario?: Ficha['cuestionario'] }).cuestionario : undefined,
    diferimiento: r.diferido ? { tipo: 'permanente', origen: 'laboratorio', desde: r.diferido.desde } : undefined,
    proximaDonacion: dons[0]?.fecha ? sumar(dons[0].fecha, r.sexo === 'F' ? 120 : 90) : undefined,
  };
}

/**
 * Busca la ficha por el contenido del QR (enlace /verificar?id=…), el ID BLD-… o la cédula.
 * Devuelve null si no existe; lanza un Error con el motivo si la base rechaza la consulta.
 */
export async function obtenerFicha(q: string): Promise<Ficha | null> {
  if (!usaSupabase()) {
    const r = buscarRegistro(q);
    return r ? fichaDeRegistro(r) : null;
  }
  const { data, error } = await sb()!.rpc('blud_donante_ficha', { p_q: q });
  if (error) throw new Error(error.message);
  return (data as Ficha | null) ?? null;
}

/**
 * Vista pública del carnet (cualquiera que escanee el QR): foto, nombre, cédula, ID, teléfono y tipo de sangre.
 * Con base real exige el código secreto del QR; en modo demo sale del registro de este navegador.
 */
export async function obtenerCarnetPublico(id: string, token: string): Promise<Ficha | null> {
  if (!usaSupabase()) {
    const r = buscarRegistro(id);
    if (!r) return null;
    const f = fichaDeRegistro(r);
    return { id: f.id, nombres: f.nombres, apellidos: f.apellidos, cedula: f.cedula, telefono: f.telefono, sangre: f.sangre, verificado: f.verificado, foto: f.foto };
  }
  if (!token) return null;
  const { data, error } = await sb()!.rpc('blud_carnet_publico', { p_id: id, p_token: token });
  if (error) throw new Error(error.message);
  return (data as Ficha | null) ?? null;
}

/** URL para mostrar la foto: data URL (demo) o enlace del bucket fotos-donantes (lectura por enlace). */
export async function urlFotoFicha(foto?: string): Promise<string | null> {
  if (!foto) return null;
  if (foto.startsWith('data:')) return foto;
  const c = sb();
  if (!c) return null;
  return c.storage.from('fotos-donantes').getPublicUrl(foto).data.publicUrl ?? null;
}

const nombreDe = (f: Ficha) => `${f.nombres ?? ''} ${f.apellidos ?? ''}`.trim() || 'Donante BLUD';

/**
 * Rellena un componente FichaDonante con la ficha. Devuelve cuando la foto (si hay) ya está puesta.
 * Con `publico`, oculta lo que solo ve el personal (nacimiento, sexo, correo, donaciones, citas).
 */
export async function pintarFicha(card: HTMLElement, f: Ficha, opciones: { publico?: boolean } = {}): Promise<void> {
  card.querySelectorAll<HTMLElement>('[data-ff-privado]').forEach((el) => (el.hidden = !!opciones.publico));
  const escHtml = (t: string) => t.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
  const set = (k: string, v: string | number | undefined | null) => {
    const el = card.querySelector(`[data-ff="${k}"]`);
    if (el) el.textContent = v === undefined || v === null || v === '' ? '—' : String(v);
  };
  const nombre = nombreDe(f);
  set('nombre', nombre);
  set('iniciales', nombre.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?');
  set('id', f.id);
  set('sangre', f.sangre);
  set('cedula', f.cedula);
  set('telefono', f.telefono);
  const edad = f.nacimiento ? edadDe(f.nacimiento) : null;
  set('nacimiento', f.nacimiento ? `${fmtFecha(f.nacimiento)}${edad !== null ? ` (${edad} años)` : ''}` : '');
  set('sexo', f.sexo === 'F' ? 'Femenino' : f.sexo === 'M' ? 'Masculino' : '');
  set('email', f.email);
  set('registrado', f.registrado ? fmtFecha(f.registrado) : '');
  set('donaciones', f.donaciones ?? 0);
  set('ultima', f.ultimaDonacion ? fmtFecha(f.ultimaDonacion) : 'Primera vez');
  set('cita', f.proximaCita
    ? `${f.proximaCita.centro} · ${fmtFecha(f.proximaCita.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${f.proximaCita.time}`
    : 'Sin cita agendada');

  // ---- Datos del pre-registro (RF-D11) y próxima donación (RF-D6)
  set('direccion', f.direccion);
  set('ocupacion', f.ocupacion);
  const ce = f.contactoEmergencia;
  set('contacto', ce?.nombre ? `${ce.nombre}${ce.parentesco ? ` (${ce.parentesco})` : ''}${ce.telefono ? ` · ${ce.telefono}` : ''}` : '');
  const hoy = new Date().toISOString().slice(0, 10);
  set('proxima', f.diferimiento?.tipo === 'permanente' ? 'No puede donar' : f.proximaDonacion && f.proximaDonacion > hoy ? fmtFecha(f.proximaDonacion) : 'Ya puede donar');

  // ---- Avisos: diferimiento de toda la red (RF-O5) y contacto pedido (RF-D10). Sin motivos clínicos.
  const avisos = card.querySelector<HTMLElement>('[data-ff-avisos]');
  if (avisos) {
    const items: string[] = [];
    const d = f.diferimiento;
    if (d?.tipo === 'permanente') {
      items.push(`<div class="ficha-aviso" data-nivel="alto"><i class="dot"></i><div><strong>Diferido: no puede donar</strong><span>${d.origen === 'laboratorio' ? 'Lo indicó el laboratorio' : `Evaluación médica${d.sede ? ' en ' + escHtml(d.sede) : ''}`}${d.desde ? ' el ' + fmtFecha(d.desde) : ''}. El motivo lo conoce el personal médico.</span></div></div>`);
    } else if (d?.tipo === 'temporal' && d.hasta) {
      items.push(`<div class="ficha-aviso"><i class="dot"></i><div><strong>Diferido hasta el ${fmtFecha(d.hasta)}</strong><span>Evaluación médica${d.sede ? ' en ' + escHtml(d.sede) : ''}${d.desde ? ' del ' + fmtFecha(d.desde) : ''}.</span></div></div>`);
    } else if (f.proximaDonacion && f.proximaDonacion > hoy) {
      items.push(`<div class="ficha-aviso"><i class="dot"></i><div><strong>Aún en periodo de espera</strong><span>Donó el ${fmtFecha(f.ultimaDonacion ?? '')}; podrá volver desde el ${fmtFecha(f.proximaDonacion)}.</span></div></div>`);
    }
    if (f.contactoPendiente) {
      items.push(`<div class="ficha-aviso" data-nivel="alto"><i class="dot"></i><div><strong>El laboratorio pidió contactar a este donante</strong><span>Pídele que se acerque al centro. No compartas resultados por chat ni por teléfono.</span></div></div>`);
    }
    if (f.cuestionario && !f.cuestionario.apto) {
      items.push(`<div class="ficha-aviso"><i class="dot"></i><div><strong>Su cuestionario de salud tiene ${f.cuestionario.alertas.length} alerta${f.cuestionario.alertas.length === 1 ? '' : 's'}</strong><span>Revísalas abajo antes de la evaluación.</span></div></div>`);
    }
    avisos.innerHTML = items.join('');
    avisos.dataset.vacio = String(!items.length);
  }

  // ---- Cuestionario (RF-D4)
  const cuest = card.querySelector<HTMLElement>('[data-ff-cuest]');
  if (cuest) {
    const c = f.cuestionario;
    cuest.dataset.vacio = String(!c);
    if (c) {
      const dias = Math.floor((Date.now() - new Date(c.fecha).getTime()) / 86400000);
      card.querySelector('[data-ff-cuest-resumen]')!.textContent =
        `Respondido el ${fmtFecha(c.fecha.slice(0, 10))}${dias > 30 ? ' (vencido)' : ''} · ${c.apto ? 'sin alertas' : `${c.alertas.length} alerta${c.alertas.length === 1 ? '' : 's'}`}`;
      const resp = [...(c.respuestas ?? [])].sort((a, b) => Number(b.alerta) - Number(a.alerta));
      card.querySelector('[data-ff-cuest-lista]')!.innerHTML = resp
        .map((x) => `<li data-alerta="${x.alerta}"><b>${escHtml(x.pregunta)}</b><span>${escHtml(x.respuesta)}</span></li>`)
        .join('');
    }
  }

  const estado = card.querySelector<HTMLElement>('[data-ff-estado]');
  if (estado) {
    estado.textContent = f.verificado ? 'Identidad verificada' : 'Sin verificar';
    estado.dataset.ok = String(!!f.verificado);
  }

  const img = card.querySelector<HTMLImageElement>('[data-ff-foto]')!;
  const sinFoto = card.querySelector<HTMLElement>('[data-ff-sinfoto]');
  img.hidden = true;
  img.removeAttribute('src');
  card.hidden = false;
  // Si se pinta otra ficha mientras llega la foto, la foto vieja no debe aparecer.
  const turno = String(Math.random());
  card.dataset.turno = turno;
  const url = await urlFotoFicha(f.foto);
  if (card.dataset.turno !== turno) return;
  if (url) {
    img.src = url;
    img.alt = `Foto de ${nombre}`;
    img.hidden = false;
  }
  if (sinFoto) sinFoto.hidden = !!url;
}
