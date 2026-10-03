export type Solicitud = {
  id: string;
  component: string;
  group: string;
  quantity: number;
  center: string;
  requester: string;
  priority: 'Normal' | 'Urgente' | 'Crítica';
  createdAt: string;
  status: 'Pendiente' | 'Aprobada' | 'Rechazada';
  service?: string;
  patientCode?: string;
  neededBy?: string;
  reason?: string;
};

export const solicitudesIniciales: Solicitud[] = [
  { id: 'REQ-2026-042', component: 'Glóbulos rojos', group: 'O+', quantity: 4, center: 'Hospital Central · UCI', requester: 'Dr. Roberto Silva', priority: 'Urgente', createdAt: '2026-09-30T11:20:00', status: 'Pendiente' },
  { id: 'REQ-2026-039', component: 'Plaquetas', group: 'A-', quantity: 2, center: 'Clínica San José', requester: 'Dra. María Morales', priority: 'Normal', createdAt: '2026-09-30T09:15:00', status: 'Pendiente' },
  { id: 'REQ-2026-035', component: 'Plasma fresco', group: 'B+', quantity: 5, center: 'Pabellón quirúrgico', requester: 'Dr. Carlos Gómez', priority: 'Crítica', createdAt: '2026-09-29T16:45:00', status: 'Pendiente' },
  { id: 'REQ-2026-028', component: 'Glóbulos rojos', group: 'AB+', quantity: 2, center: 'Hospital Central · Hematología', requester: 'Dra. Elena Ríos', priority: 'Normal', createdAt: '2026-09-27T13:10:00', status: 'Aprobada' },
  { id: 'REQ-2026-021', component: 'Crioprecipitado', group: 'O-', quantity: 3, center: 'Clínica del Valle', requester: 'Dr. Luis Herrera', priority: 'Urgente', createdAt: '2026-09-25T08:40:00', status: 'Rechazada' },
];