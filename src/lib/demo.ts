// src/lib/demo.ts
// Datos de ejemplo coherentes para TODOS los roles: el mismo donante, su donación, sus pruebas,
// el stock que deja y la solicitud que lo consume. Fechas relativas a hoy para que nada aparezca vencido de golpe.
// Es idempotente: solo crea lo que falta, nunca pisa lo que ya editaste.

import {
  PRUEBAS, codigoDonacion, codigoTicket, donaciones, entregas, fracciones, pedidos, positivos, pruebas, registro, tickets,
} from './db';
import type { Collection, DonacionOp, EstadoLab, Hemocomponente, ResultadoPrueba } from './db';
import { hoyISO, sumarDias, uid } from './ui';

// Personal de las cuentas de prueba (lib/auth → demoUsers): así cada acción queda a nombre de alguien real.
const OPERADOR = 'operador@blud.app';
const LABORATORIO = 'laboratorio@blud.app';
const DIRECCION = 'maria@blud.app';
const SEDE = 'Hospital Central Maracaibo';

const FLAG = 'blud-demo-seeded';

function add<T extends { id: string }>(col: Collection<T>, item: T) {
  if (!col.get(item.id)) col.upsert(item);
}

export function seedDemo() {
  const hoy = hoyISO();
  const d = (n: number) => sumarDias(hoy, -n);
  const sinReactivos = (over: Record<string, ResultadoPrueba> = {}) =>
    Object.fromEntries(PRUEBAS.map((p) => [p.id, over[p.id] ?? 'no_reactivo'])) as Record<string, ResultadoPrueba>;

  // ---------- Donantes
  const donante = (id: string, nombre: string, cedula: string, sangre: string, dias: number, estado: 'preregistrado' | 'verificado', origen: 'app' | 'operador' = 'app') =>
    add(registro, {
      id, cedula, nombreCompleto: nombre, sangre, fechaRegistro: d(dias), estado, origen,
      operadorId: estado === 'verificado' ? OPERADOR : undefined,
      fechaVerificacion: estado === 'verificado' ? d(dias) : undefined,
    });
  donante('demo-1', 'Laura Pérez', 'V-20111222', 'O+', 1, 'preregistrado');
  donante('demo-2', 'Carlos Rincón', 'V-18222333', 'A-', 2, 'preregistrado');
  donante('demo-3', 'Ana Morales', 'V-15333444', 'O-', 60, 'verificado', 'operador');
  donante('demo-4', 'Luis Fernández', 'V-12444555', 'B+', 120, 'verificado');
  donante('demo-5', 'Pedro Sánchez', 'V-14555666', 'A+', 50, 'verificado', 'operador');
  donante('demo-6', 'Gabriela Ruiz', 'V-19777888', 'AB+', 45, 'verificado');
  donante('demo-7', 'José Valbuena', 'V-16888999', 'O+', 15, 'verificado', 'operador');
  donante('demo-8', 'Carmen Urdaneta', 'V-17999000', 'O+', 20, 'verificado');

  // ---------- Donaciones y laboratorio
  const donacion = (id: string, donanteId: string, comp: Hemocomponente, dias: number, estadoLab: EstadoLab) => {
    const r = registro.get(donanteId)!;
    add(donaciones, {
      id, donanteId, donanteNombre: r.nombreCompleto, donanteCedula: r.cedula, tipoSangre: r.sangre,
      tipoHemocomponente: comp, volumenMl: comp === 'Plaquetas' ? 250 : 450, fecha: d(dias),
      operadorId: OPERADOR, centroNombre: SEDE, estadoLab,
    } satisfies DonacionOp);
  };
  const negativa = (id: string, donacionId: string, dias: number) => {
    const don = donaciones.get(donacionId)!;
    add(pruebas, {
      id, donacionId, codigo: codigoDonacion(donacionId), fecha: d(dias), resultados: sinReactivos(),
      resultadoGlobal: 'negativo', tipoSangreConfirmado: don.tipoSangre, laboratoristaId: LABORATORIO,
    });
  };

  donacion('demo-d1', 'demo-3', 'Sangre Total', 25, 'liberada');
  negativa('demo-pr1', 'demo-d1', 24);
  add(fracciones, {
    id: 'demo-fr1', donacionId: 'demo-d1', codigo: codigoDonacion('demo-d1'), fecha: d(24), laboratoristaId: LABORATORIO,
    productos: [
      { componente: 'Concentrado Globular', unidades: 1, volumenMl: 250 },
      { componente: 'Plasma Fresco Congelado', unidades: 1, volumenMl: 200 },
      { componente: 'Plaquetas', unidades: 1, volumenMl: 50 },
    ],
  });

  donacion('demo-d2', 'demo-4', 'Sangre Total', 12, 'liberada');
  negativa('demo-pr2', 'demo-d2', 11);

  donacion('demo-d3', 'demo-6', 'Concentrado Globular', 38, 'liberada');
  negativa('demo-pr3', 'demo-d3', 37);

  donacion('demo-d4', 'demo-3', 'Plaquetas', 3, 'liberada');
  negativa('demo-pr4', 'demo-d4', 2);

  donacion('demo-d8', 'demo-8', 'Sangre Total', 10, 'liberada');
  negativa('demo-pr8', 'demo-d8', 9);

  // Reactiva: la bolsa se descarta, se abre un caso y el donante queda diferido (sin motivo visible fuera del laboratorio)
  donacion('demo-d5', 'demo-5', 'Sangre Total', 7, 'descartada');
  add(pruebas, {
    id: 'demo-pr5', donacionId: 'demo-d5', codigo: codigoDonacion('demo-d5'), fecha: d(6),
    resultados: sinReactivos({ hbsag: 'reactivo' }), resultadoGlobal: 'positivo', tipoSangreConfirmado: 'A+', laboratoristaId: LABORATORIO,
  });
  add(positivos, {
    id: 'demo-cs5', pruebaId: 'demo-pr5', donacionId: 'demo-d5', donanteId: 'demo-5', codigo: codigoDonacion('demo-d5'),
    prueba: 'hbsag', enfermedad: 'Hepatitis B (HBsAg)', fecha: d(6), estado: 'pendiente',
  });
  const p5 = registro.get('demo-5');
  if (p5 && !p5.diferido) registro.upsert({ ...p5, diferido: { desde: d(6) } });

  // En cuarentena: el laboratorio las ve en "Pruebas"
  donacion('demo-d6', 'demo-6', 'Sangre Total', 1, 'pendiente');
  donacion('demo-d7', 'demo-7', 'Sangre Total', 0, 'pendiente');

  // ---------- Solicitudes: una de cada estado
  const base = { creadoPor: OPERADOR, creadoPorNombre: 'Dra. María Colina' };
  add(pedidos, {
    id: 'demo-p1', pacienteNombre: 'Roberto Gómez', pacienteCedula: 'V-9876543', tipoSangre: 'O-', tipoHemocomponente: 'Concentrado Globular',
    unidades: 1, hospitalDestino: SEDE, servicio: 'Emergencia', medico: 'Dr. Roberto Silva', diagnostico: 'Hemorragia digestiva alta',
    prioridad: 'urgente', fecha: d(0), estado: 'pendiente', ...base,
  });
  add(pedidos, {
    id: 'demo-p2', pacienteNombre: 'María Delgado', pacienteCedula: 'V-18765432', tipoSangre: 'B+', tipoHemocomponente: 'Sangre Total',
    unidades: 1, hospitalDestino: 'Hospital Universitario de Maracaibo', servicio: 'Cirugía', medico: 'Dra. Elena Ríos', diagnostico: 'Anemia posoperatoria',
    prioridad: 'normal', fecha: d(1), estado: 'aprobado', revisadoPor: DIRECCION, revisadoPorNombre: 'María Fernández', fechaRevision: d(1), ...base,
  });
  add(pedidos, {
    id: 'demo-p3', pacienteNombre: 'Pablo Ortiz', pacienteCedula: 'V-11222333', tipoSangre: 'AB+', tipoHemocomponente: 'Plasma Fresco Congelado',
    unidades: 2, hospitalDestino: 'Policlínica Amado', servicio: 'Medicina interna', medico: 'Dr. Luis Herrera',
    prioridad: 'normal', fecha: d(3), estado: 'rechazado', revisadoPor: DIRECCION, revisadoPorNombre: 'María Fernández', fechaRevision: d(2),
    motivoRechazo: 'Sin estudios de coagulación que justifiquen el plasma.', ...base,
  });
  add(entregas, {
    id: 'demo-e4', pedidoId: 'demo-p4', pacienteNombre: 'Elena Bracho', pacienteCedula: 'V-13444555', tipoSangre: 'O-',
    tipoHemocomponente: 'Plasma Fresco Congelado', unidades: 1, hospitalDestino: 'Hospital Coromoto', fecha: d(5), operadorId: OPERADOR,
  });
  add(pedidos, {
    id: 'demo-p4', pacienteNombre: 'Elena Bracho', pacienteCedula: 'V-13444555', tipoSangre: 'O-', tipoHemocomponente: 'Plasma Fresco Congelado',
    unidades: 1, hospitalDestino: 'Hospital Coromoto', servicio: 'UCI', medico: 'Dr. Carlos Gómez', prioridad: 'critica',
    fecha: d(6), estado: 'despachado', revisadoPor: DIRECCION, revisadoPorNombre: 'María Fernández', fechaRevision: d(6), entregaId: 'demo-e4', ...base,
  });

  // ---------- Soporte: solicitudes de donantes
  const ticket = (n: number, nombre: string, email: string, cedula: string, sangre: string, asunto: string, texto: string, prioridad: 'normal' | 'alta', mins: number) => {
    const donanteId = 'BLD-DEMO0' + n;
    add(registro, {
      id: donanteId, cedula, nombreCompleto: nombre, sangre, email, telefono: '+58 414 555010' + n, fechaRegistro: d(30),
      estado: n === 2 ? 'preregistrado' : 'verificado', origen: 'app',
    });
    const id = 'tk-demo' + n;
    const fecha = new Date(Date.now() - mins * 60000).toISOString();
    add(tickets, {
      id, codigo: codigoTicket(id), donanteId, donanteNombre: nombre, donanteEmail: email, asunto,
      estado: 'abierto', prioridad, creado: fecha, actualizado: fecha,
      mensajes: [{ id: uid(), autor: 'donante', nombre, texto, fecha }],
    });
  };
  ticket(1, 'Luis Martínez', 'luis@correo.com', 'V-12345601', 'O+', 'Mi cita', 'Agendé mi cita para el viernes pero tengo que viajar. ¿Cómo la cambio a la semana siguiente?', 'normal', 35);
  ticket(2, 'Ana Rodríguez', 'ana@correo.com', 'V-12345602', 'A+', 'Verificación de identidad', 'Subí mi cédula pero mi perfil sigue diciendo que no estoy verificada. Necesito donar esta semana.', 'alta', 120);
  ticket(3, 'Pedro Gil', 'pedro@correo.com', 'V-12345603', 'B-', 'Mi carnet o mi QR', 'El QR de mi carnet no se muestra, solo veo un recuadro en blanco.', 'normal', 600);

  try { localStorage.setItem(FLAG, hoy); } catch {}
}

/** Carga los datos de ejemplo la primera vez que alguien del personal entra (sin base de datos real conectada). */
export function seedDemoSiHaceFalta() {
  try {
    if (localStorage.getItem(FLAG) || donaciones.all().length) return;
  } catch {
    return;
  }
  seedDemo();
}
