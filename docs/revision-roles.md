# Revisión del flujo de los roles — commit 953a2fd

Revisión de solo lectura: menús (`src/lib/menus.ts`), páginas `src/pages/<rol>/`, librerías y la base (consultas SELECT).
Base actual: 13 donaciones, 20 unidades, 6 solicitudes, 16 donantes, 2 tickets, 227 filas de bitácora, 0 de `hemo_vigilancia`, 3 mensajes de chat.

## Arquitectura de datos (común a todos)
- Al entrar, cada rol llama a `blud_panel()` (16 kB de SQL). Devuelve **todas** las filas de 9 colecciones (donantes, donaciones, pedidos, entregas, pruebas, fracciones, positivos, tickets, notas). Las guarda en `localStorage` y cada página filtra en el navegador.
  - No hay ventana de fechas ni `limit` por colección: los 4 `limit` del SQL son subconsultas «el último registro de…».
- Cada escritura llama a `blud_guardar()` y luego a `sincronizar()`, que vuelve a descargar el panel completo. El costo crece con cada registro.
- Faltan índices en las columnas por las que más se filtra:
  - 34 claves foráneas sin índice;
  - `donacion(donanteid)`, `donacion(sedeid, fechadonacion)`, `donacion(personalid)`;
  - `unidadsangre(estado, componenteid, tiposangreid, sedeid)`;
  - `solicitudtransfusion(estado)`;
  - `cita(sedeid, fecha_hora_cita)`.
- Ninguna lista pagina:
  - inventario, historial del operador, registros del laboratorio, bandeja de tickets, Mis donantes y solicitudes pintan todo;
  - solo «Últimas 5» del operador y del panel recortan con `slice`.

## 1. Donante
**Recorrido:**
1. Mi perfil: carnet con QR, datos, verificación y salud.
2. Donar sangre (bloqueado hasta completar el perfil): elige centro, fecha y hora → `blud_agendar_cita`.
3. Mis citas: ver o cancelar.
4. Mensajes: chat en tiempo real.
5. Mi historial: sus donaciones.
6. Centros cercanos: mapa.
7. Soporte: crear un ticket.

**Transversales:** tiene Mi perfil, Configuración, Mensajes, Historial y Soporte (ayuda). Le falta un Panel propio (Mi perfil cumple ese papel). Las notificaciones solo cubren mensajes, no cambios de cita ni resultados.

**Cortes:**
- `perfil.astro:720` usa el chip «En revisión» (verificación pendiente): correcto.
- `centros.astro` y el diálogo de agendar usan la lista fija `data/centers.ts` y no `blud_sedes_mapa()`: la cita se enlaza a la sede por nombre.
- La base no valida horario ni cupos.

## 2. Operador
**Recorrido:**
1. Panel (citas de hoy, stock, por despachar).
2. Citas del centro: «Llegó» → «Atender».
3. Donantes: QR, búsqueda, verificación y ficha.
4. Donaciones: evaluación y extracción, con DIN ISBT.
5. Solicitar transfusión.
6. Despachos.
7. Hemovigilancia.
8. Mensajes.
9. Historial.

**Transversales:** tiene Panel, Mi perfil, Configuración, Mensajes e Historial. Le falta «Reportar un problema a soporte». Las notificaciones solo cubren mensajes, no citas nuevas ni compatibilidad lista.

**Cortes (contradicen el modelo vigente):**
- `prescribir.astro:113`: el botón dice **«Enviar a la dirección»** y `private.g_pedido` crea la solicitud en estado *Pendiente*. Según el modelo vigente debe reservar stock propio e ir directo al laboratorio.
- `panel.astro:46`: «en revisión de la dirección».
- `entregas.astro:43` y `:222`: «Tus órdenes en revisión», y el despacho exige el estado *Aprobada* por el director.
- **Hemovigilancia del operador NO guarda nada:**
  - usa una lista fija `reportesEnJornada` en el código;
  - «Transmitir Registro al Banco Central» solo modifica la tabla en pantalla;
  - `hemo_vigilancia` tiene 0 filas. Pendiente RF-H1, H2 y H4.
- Despachos e Historial cargan todo sin paginar.

## 3. Laboratorio
**Recorrido:**
1. Panel.
2. Pruebas: tamizaje de cada donación → liberar, descartar o marcar positivo.
3. Fraccionamiento.
4. Compatibilidad: tipaje y pruebas cruzadas (RPC propias).
5. Casos positivos: notificar.
6. Reportes.
7. Registros.

**Transversales:** tiene Panel, Mi perfil, Configuración y Registros (su historial). Le faltan:
- Mensajes: el contacto con el donante pasa por el operador, con la marca `contactoPendiente`.
- Ayuda a soporte.
- Notificaciones (por ejemplo, «nueva muestra para tipaje»).

**Cortes:**
- Compatibilidad lista solo solicitudes *Aprobada*: si la transfusión local deja de requerir aprobación, debe listar también las locales «en preparación».
- Pruebas y Registros no paginan.

## 4. Director
**Recorrido:**
1. Panel.
2. Solicitudes (aprobar o rechazar).
3. Inventario.
4. Hemovigilancia.
5. Mapa de calor.
6. Reportes (PDF).
7. Personal.

**Transversales:** tiene Panel, Mi perfil y Configuración. Le faltan:
- Mensajes (con otros directores, para los pedidos entre centros);
- Historial o bitácora: T9, I2 y A4 siguen pendientes, aunque `bitacora_auditoria` ya tiene 227 filas sin pantalla;
- Ayuda;
- Notificaciones de pedidos entrantes.

**Cortes (contradicen el modelo vigente):**
- `solicitudes/historial.astro:3` y `:20`: «El operador las registra…; tú las apruebas o rechazas». Hoy aprueba solicitudes locales del operador; según el modelo debe aprobar solo **pedidos de otros centros**.
- No existe la pantalla para que el director **pida** unidades a otro centro (`registro.astro` solo corrige con `?id`).
- `registro.astro:27`, subtítulo: «Lo que registra la dirección queda aprobado y pasa directo a despacho».
- `lib/director.ts:40`: un comentario dice lo mismo, y `crearSolicitud` sigue existiendo en modo demo.
- El esquema no distingue la sede origen de la sede proveedora del pedido: `solicitudtransfusion` no tiene una «sede proveedora».
- **Hemovigilancia del director es 100 % maqueta:** usa `reportesHemovigilancia` fijo en el frontmatter, con sedes inventadas («Hospital Central del Sur», «Clínica San Rafael») y texto con restos `[cite: 1]`. El PDF de auditoría imprime esos datos de ejemplo.
- Inventario y Solicitudes sin paginar. El mapa de calor calcula todo en el cliente con `donaciones.all()`, lo que no escala.
- `proceso.astro:100` y `:645` (página pública): «La dirección aprueba» la orden.

## 5. Soporte (y administrador técnico)
**Recorrido:**
1. Panel.
2. Solicitudes: tomar, responder, resolver, marcar urgente y dejar notas internas.
3. Donantes (solo lectura).
4. Mensajes.

**Transversales:** tiene Panel, Mi perfil, Configuración y Mensajes. Le falta su historial o actividad.

**Cortes:**
- El rol de administrador técnico (A1–A4) no está:
  - activar o desactivar cuentas y restablecer acceso: hoy solo lo hace el director en Personal;
  - registro de incidencias;
  - corrección de estados con justificación;
  - bitácora.
- No hay tiempo de primera respuesta ni de resolución (RF-S4).
- La bandeja de tickets no pagina.

## Matriz de pantallas transversales
| | Panel | Mi perfil | Configuración | Mensajes | Historial | Ayuda a soporte | Notificaciones |
|---|---|---|---|---|---|---|---|
| Donante | (perfil) | sí | sí | sí | sí | sí | solo mensajes |
| Operador | sí | sí | sí | sí | sí | **no** | solo mensajes |
| Laboratorio | sí | sí | sí | **no** | sí (Registros) | **no** | **no** |
| Director | sí | sí | sí | **no** | **no** (bitácora) | **no** | **no** |
| Soporte | sí | sí | sí | sí | **no** | — | solo mensajes |

## Prioridades recomendadas
1. **Flujo de solicitudes (bloqueante, contradice el modelo):**
   - la transfusión local va directo al laboratorio, sin aprobación;
   - nueva solicitud entre centros, con sede solicitante y sede proveedora: el director pide y el director proveedor aprueba;
   - corregir los textos de operador, director, laboratorio y `proceso.astro`.
2. **Rendimiento:**
   - partir `blud_panel` en RPC por pantalla con paginación del lado del servidor (`limit`/`offset` o cursor, con filtros);
   - mantener en caché solo lo reciente, por ejemplo 90 días;
   - después de guardar, actualizar solo lo afectado, sin volver a descargar todo;
   - crear los índices que faltan;
   - componente de paginación común (en la tabla apilable).
3. **Hemovigilancia real (H1, H2, H4):** el operador guarda en `hemo_vigilancia` desde el despacho, con doble verificación, signos y reacciones, y el director la consulta. Quitar las maquetas.
4. **Bitácora y administrador técnico (T9, I2, A1–A4):** pantalla de bitácora paginada para director y soporte, más gestión de cuentas e incidencias.
5. **Transversales:**
   - «Reportar un problema» (ticket interno) para el personal;
   - Mensajes entre directores para los pedidos;
   - notificaciones de eventos (pedido entrante, muestra para tipaje, cita nueva).
6. **Sedes desde la base:** `/centros`, Donar y el diálogo de agendar usan `blud_sedes_mapa()`; agendar por `sedeid` con validación de horario y cupos.

Nota: la revisión se hizo sobre el código y la base. No se navegó con Playwright para no competir con los otros agentes por el servidor de desarrollo.
