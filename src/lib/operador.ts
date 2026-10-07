// src/lib/operador.ts

export type TipoHemocomponente = 'Sangre Total' | 'Concentrado Globular' | 'Plaquetas' | 'Plasma Fresco Congelado' | 'Crioprecipitado';

export interface DonanteRegistrado {
  id: string;
  cedula: string;
  nombreCompleto: string;
  sangre: string;
  fechaRegistro: string;
  estado: 'verificado' | 'pendiente';
}

export interface RegistroDonacion {
  id: string;
  donanteId: string;
  donanteNombre: string;
  donanteCedula: string;
  tipoSangre: string;
  tipoHemocomponente: TipoHemocomponente;
  volumenMl: number;
  fecha: string;
  operadorId: string;
}

export interface EntregaHemocomponente {
  id: string;
  pacienteNombre: string;
  pacienteCedula: string;
  tipoSangre: string;
  tipoHemocomponente: TipoHemocomponente;
  unidades: number;
  hospitalDestino: string;
  fecha: string;
  ordenMedicaUrl?: string;
  operadorId: string;
}

const K_OPERADOR = 'blud-operador-session';
const K_DONANTES_OP = 'blud-op-donantes';
const K_DONACIONES_OP = 'blud-op-donaciones';
const K_ENTREGAS_OP = 'blud-op-entregas';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export const uid = () => Math.random().toString(36).slice(2, 10);

// Donantes registrados por el operador
export const getDonantesOp = () => read<DonanteRegistrado[]>(K_DONANTES_OP, [
  { id: 'd1', cedula: 'V-28123456', nombreCompleto: 'Carlos Mendoza', sangre: 'O+', fechaRegistro: '2026-10-01', estado: 'verificado' },
  { id: 'd2', cedula: 'V-25987654', nombreCompleto: 'Ana Gutierrez', sangre: 'A-', fechaRegistro: '2026-10-03', estado: 'verificado' }
]);

export const saveDonanteOp = (d: DonanteRegistrado) => {
  const list = getDonantesOp();
  write(K_DONANTES_OP, [d, ...list]);
};

// Donaciones registradas
export const getDonacionesOp = () => read<RegistroDonacion[]>(K_DONACIONES_OP, [
  { id: 'don-1', donanteId: 'd1', donanteNombre: 'Carlos Mendoza', donanteCedula: 'V-28123456', tipoSangre: 'O+', tipoHemocomponente: 'Sangre Total', volumenMl: 450, fecha: '2026-10-04', operadorId: 'op-101' }
]);

export const saveDonacionOp = (don: RegistroDonacion) => {
  const list = getDonacionesOp();
  write(K_DONACIONES_OP, [don, ...list]);
};

// Entregas de Hemocomponentes
export const getEntregasOp = () => read<EntregaHemocomponente[]>(K_ENTREGAS_OP, [
  { id: 'ent-1', pacienteNombre: 'Roberto Gómez', pacienteCedula: 'V-14235678', tipoSangre: 'O+', tipoHemocomponente: 'Concentrado Globular', unidades: 2, hospitalDestino: 'Hospital Coromoto', fecha: '2026-10-05', operadorId: 'op-101' }
]);

export const saveEntregaOp = (ent: EntregaHemocomponente) => {
  const list = getEntregasOp();
  write(K_ENTREGAS_OP, [ent, ...list]);
};