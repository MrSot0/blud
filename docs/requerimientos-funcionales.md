<!-- Copia del documento «BLUD — Requerimientos funcionales unificados» (Claude Docs,
https://claude.ai/artifact/ASk5sW2JksG5chd76iXRBy), versión del 20-10-2026. Las columnas «Estado (25-11)» y «Nota»
son una revisión contra el código al 25-11-2026; el resto es el texto original. -->

> **Estado al 27-11-2026:** 80 hechos, 7 parciales, 4 pendientes y 1 que cambió por decisión del
> usuario (de 92). Todas las migraciones están aplicadas en la base.

# BLUD — Requerimientos funcionales unificados

2026-10-20 · @jesus

## Resumen

BLUD tiene **92 requerimientos funcionales** : 28 hechos, 25 parciales y 39 pendientes. Los 31 del documento original quedan en 22, porque 9 estaban repetidos por rol (editar perfil, recuperar contraseña, 2FA y chatbot); los otros 70 son nuevos y salen del documento de procesos, de las páginas del director y de lo que ya construimos.

| Área | Prefijo | Total | Hechos | Parciales | Pendientes |
|---|---|---|---|---|---|
| Transversales | RF-T | 13 | 3 | 4 | 6 |
| Donante | RF-D | 11 | 5 | 4 | 2 |
| Operador | RF-O | 14 | 8 | 4 | 2 |
| Laboratorio | RF-L | 11 | 6 | 3 | 2 |
| Director | RF-DIR | 9 | 2 | 6 | 1 |
| Soporte | RF-S | 4 | 3 | 0 | 1 |
| Administrador técnico | RF-A | 4 | 0 | 0 | 4 |
| Inventario (M06) | RF-I | 8 | 1 | 2 | 5 |
| Distribución (M07) | RF-DS | 5 | 0 | 1 | 4 |
| Transfusión (M08) | RF-TR | 7 | 0 | 1 | 6 |
| Hemovigilancia (M09) | RF-H | 6 | 0 | 0 | 6 |
| Total |  | 92 | 28 | 25 | 39 |

**Hecho** = funciona con datos reales del sistema. **Parcial** = existe la interfaz o una parte del proceso, pero falta alcance o los datos son de ejemplo. **Pendiente** = no existe. En la columna Origen, "Doc" es el documento de requerimientos (G = generales, O = operador, L = laboratorio), "Procesos" y "Diagrama de procesos" son el documento de procesos, "Páginas director" son las páginas ya hechas del director y "Nuevo" es propuesto aquí.

## Transversales (RF-T)

Aplican a todos los roles. Aquí se unifican los requerimientos que el documento repetía en cada rol.

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-T1 | El usuario debe poder registrarse (pre-registro como donante) | Doc G1 | Hecho | Hecho |  |
| RF-T2 | El usuario debe poder iniciar sesión | Doc G2 | Hecho | Hecho |  |
| RF-T3 | El sistema debe asignar roles (donante, operador, laboratorio, soporte, director, administrador técnico) y mostrar menús y rutas según el rol | Doc G3 | Parcial | Hecho | 6 roles con menú y rutas por rol; soporte cumple el papel de administrador técnico |
| RF-T4 | Todo usuario debe poder editar los atributos de su perfil y cambiar su contraseña desde un panel de configuración | Doc G9, O10, L5 | Hecho | Hecho |  |
| RF-T5 | El usuario debe poder recuperar su contraseña sin haber iniciado sesión | Doc G10, O11, L6 | Pendiente | Hecho | /recuperar |
| RF-T6 | El sistema debe permitir verificación en dos factores al iniciar sesión | Doc G11, O12, L7 | Pendiente | Hecho | 2FA TOTP (lib/mfa.ts); falta decidir si es obligatoria para el personal |
| RF-T7 | Un agente de IA debe guiar a donantes, operadores y laboratorio en los procesos del sistema y permitir operaciones simples | Doc G7, O9, L8 | Parcial | Parcial | chat con Gemini (/api/chat); no ejecuta operaciones |
| RF-T8 | La sesión debe cerrarse por inactividad y el usuario debe poder cerrar sesión en todos sus dispositivos | Nuevo | Pendiente | Hecho | cierre por inactividad y «Cerrar sesión en todos los dispositivos» en Configuración → Seguridad (verificado 27-11) |
| RF-T9 | El sistema debe registrar quién hizo cada cambio de estado, cuándo y desde qué sede (bitácora de auditoría) | Procesos M06 | Pendiente | Hecho | bitácora con pantalla para dirección y soporte; migraciones aplicadas y probadas (27-11) |
| RF-T10 | El sistema debe enviar notificaciones por correo y WhatsApp (citas, resultados que requieren contacto, estado de solicitudes) | Procesos M03 | Pendiente | Pendiente | requiere SMTP y proveedor de WhatsApp |
| RF-T11 | La autorización por rol debe verificarse en el servidor, no solo en la interfaz | Nuevo | Pendiente | Hecho | RLS y RPC con _exigir_rol en Supabase |
| RF-T12 | Cada usuario del personal debe pertenecer a una sede y ver los datos de esa sede en su dashboard | Doc O1, L4 | Parcial | Hecho | personal con sede (_sede_id) y paneles por sede |
| RF-T13 | Las listas y reportes deben poder exportarse a CSV y PDF | Nuevo | Parcial | Hecho | CSV en listas y PDF con marca BLUD en reportes |

## Donante (RF-D)

El donante llena el cuestionario de autoexclusión antes de ir al centro; el enfermero lo revisa en la evaluación médica (RF-O7).

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-D1 | El donante debe poder consultar la sede más cercana para donar | Doc G4 | Hecho | Hecho |  |
| RF-D2 | El donante debe poder informarse sobre cómo donar | Doc G5 | Hecho | Hecho |  |
| RF-D3 | El donante debe poder hacer un micro-test para saber si es apto | Doc G6 | Hecho | Hecho |  |
| RF-D4 | El donante debe poder llenar el cuestionario de autoexclusión (~30 preguntas: salud, viajes, cirugías, medicamentos, vacunas) antes de ir, y este debe quedar en su perfil para el enfermero | Procesos M01 | Pendiente | Hecho | cuestionario de salud por partes en el perfil |
| RF-D5 | El donante debe tener un carnet digital con QR y verificación de identidad (KYC) | Nuevo | Hecho | Hecho |  |
| RF-D6 | El donante debe ver su historial de donaciones y la fecha desde la que puede volver a donar, calculada según sexo y tipo de extracción | Procesos M03 | Parcial | Parcial | próxima donación a 90 días (hombre) o 120 (mujer); falta según tipo de extracción |
| RF-D7 | El donante debe poder agendar una cita de donación en una sede | Procesos M03 | Parcial | Hecho | la base valida día, horario y cupo por hora de cada sede (`blud_cupos`, `blud_agendar_cita`); el formulario deshabilita las horas llenas o fuera de horario |
| RF-D8 | El donante debe recibir recordatorios por WhatsApp para volver a donar y mensajes de campañas | Procesos M03 | Pendiente | Pendiente | requiere proveedor de WhatsApp |
| RF-D9 | El donante debe poder abrir tickets con soporte y ver las respuestas | Doc G8 | Hecho | Hecho |  |
| RF-D10 | El donante debe ser contactado cuando una prueba resulte reactiva, sin que la app muestre resultados de laboratorio | Procesos M05 | Parcial | Hecho | marca «contacto pendiente» en la ficha y registro del contacto en la bitácora, sin mostrar resultados |
| RF-D11 | El pre-registro debe pedir nombre, apellido, cédula, nacionalidad, fecha de nacimiento, sexo, dirección, teléfono, correo, ocupación y su dirección, y contacto de emergencia | Procesos M01 | Parcial | Hecho | el perfil pide todos los datos, incluidos ocupación y contacto de emergencia (verificado 26-11) |

## Operador (RF-O)

El operador cubre admisión, evaluación médica y extracción (M01–M03), además de órdenes y entregas.

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-O1 | El operador debe tener un dashboard con estadísticas de su perfil y su sede | Doc O1 | Hecho | Hecho |  |
| RF-O2 | El operador debe completar la verificación de identidad de los pre-registros | Doc O2 | Hecho | Hecho |  |
| RF-O3 | El operador debe poder consultar los donantes que ha registrado | Doc O3 | Hecho | Hecho |  |
| RF-O4 | El operador debe poder registrar en sede a un donante que no se pre-registró | Nuevo | Hecho | Hecho |  |
| RF-O5 | Al admitir, el sistema debe verificar diferimientos previos del donante en toda la red de centros | Procesos M01 | Parcial | Hecho | evaluar_donante revisa los diferimientos del donante, que es único en toda la red (verificado 26-11) |
| RF-O6 | Al admitir, el sistema debe crear el identificador único de donación (DIN, ISBT-128) | Procesos M01 | Pendiente | Hecho | DIN ISBT 128 por sede (donacion.din_isbt) |
| RF-O7 | El operador debe hacer la evaluación médica: signos vitales (presión 90–180/60–100 mmHg, pulso 50–100, temperatura ≤ 37,5 °C, peso ≥ 50 kg), hemoglobina (mujer ≥ 12,5, hombre ≥ 13,5 g/dL) y hematocrito (≥ 38 %), y registrar el dictamen: apto, rechazo temporal o permanente | Procesos M02 | Pendiente | Hecho | evaluación médica obligatoria con dictamen |
| RF-O8 | El operador debe registrar la extracción: inicio y fin, volumen, tipo de bolsa y anticoagulante, enfermero responsable, tipo de donación (voluntaria, reposición, autóloga, aféresis) y reacciones durante la donación | Procesos M03 | Parcial | Hecho | extracción con tipo, bolsa, tiempos y reacciones |
| RF-O9 | Toda donación registrada debe quedar en cuarentena, pendiente de muestreo en laboratorio | Doc O4, O8 | Hecho | Hecho |  |
| RF-O10 | El operador debe registrar las unidades de sangre recibidas en una sede, incluidas las que llegan de otros centros | Doc O7 | Parcial | Hecho | recepción de pedidos entre centros |
| RF-O11 | El operador debe poder registrar órdenes para solicitar o prescribir hemocomponentes | Doc O5 | Hecho | Hecho |  |
| RF-O12 | El operador debe poder consultar las órdenes que ha prescrito, con su estado | Doc O6 | Parcial | Hecho | Despachos y Solicitar transfusión con estados |
| RF-O13 | El operador debe registrar entregas, con o sin pedido previo, y el stock debe descontarse | Nuevo | Hecho | Hecho |  |
| RF-O14 | El operador debe ver su historial de verificaciones, donaciones, pedidos y entregas | Nuevo | Hecho | Hecho |  |

## Laboratorio (RF-L)

Cubre M04 y M05: fraccionamiento, inmunohematología y serología.

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-L1 | El laboratorio debe poder consultar las muestras pendientes | Doc L1 | Hecho | Hecho |  |
| RF-L2 | El laboratorio debe poder consultar el registro de muestras procesadas | Doc L2 | Hecho | Hecho |  |
| RF-L3 | El laboratorio debe registrar serología (VIH 1 y 2, HBsAg, anti-HBc, anti-HCV, Chagas, sífilis, HTLV I/II) con resultado reactivo, no reactivo o indeterminado | Procesos M05 | Hecho | Hecho |  |
| RF-L4 | El laboratorio debe registrar inmunohematología: grupo ABO, Rh, test de Coombs y anticuerpos irregulares | Procesos M05 | Parcial | Hecho | grupo y Rh confirmados, Coombs directo y anticuerpos irregulares en el tamizaje de la donación (27-11) |
| RF-L5 | El laboratorio debe marcar alerta en las pruebas positivas y registrar el contacto con el donante | Doc L3 | Hecho | Hecho |  |
| RF-L6 | Según el resultado, el laboratorio debe liberar la unidad (disponible) o descartarla con su causa de baja | Procesos M05 | Parcial | Hecho | liberar o descartar al registrar el tamizaje |
| RF-L7 | El laboratorio debe registrar el fraccionamiento: componentes, volumen, fecha, fecha y hora de caducidad, código ISBT-128 y centrifugación (RCF, tiempo, temperatura) | Procesos M04 | Parcial | Hecho | componentes, volumen, centrifugación obligatoria (RCF, tiempo, temperatura), caducidad con hora y código por producto (27-11) |
| RF-L8 | El laboratorio debe registrar las variantes del hemocomponente: leucorreducido, lavado, irradiado, pool de plaquetas o plaquetoféresis, hora de congelación del plasma | Procesos M04 | Pendiente | Hecho | leucorreducido, lavado, irradiado, solución aditiva, método (pool o aféresis) y hora de congelación del plasma (27-11) |
| RF-L9 | El laboratorio debe poder generar reportes de sus registros | Nuevo | Hecho | Hecho |  |
| RF-L10 | El laboratorio debe tener un dashboard con estadísticas de su perfil y su sede | Doc L4 | Hecho | Hecho |  |
| RF-L11 | El sistema debe poder recibir resultados directamente de los analizadores | Procesos M05 | Pendiente | Pendiente | integración con los analizadores |

## Director (RF-DIR)

Las páginas del director ya existen en el proyecto, pero el inventario, el dashboard, los operadores y los reportes usan datos de ejemplo y no están conectados al resto de los roles.

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-DIR1 | El director debe tener un dashboard con los movimientos y estadísticas de su sede y de la red | Páginas director | Parcial | Hecho | panel con datos reales |
| RF-DIR2 | El director debe ver el inventario por unidad (DIN, tipo, grupo, volumen, estado, vencimiento y alerta), alimentado por las donaciones y pruebas reales | Páginas director | Parcial | Hecho | inventario por unidad desde la base |
| RF-DIR3 | El director debe gestionar requisiciones pendientes y ver el historial de movimientos de inventario | Páginas director | Parcial | Parcial | pedidos entre centros; historial de movimientos vía bitácora (sin aplicar) |
| RF-DIR4 | El director debe crear, modificar y desactivar cuentas del personal con cualquier rol (operador, laboratorio, soporte) | Procesos (director) | Parcial | Hecho | Personal: crear, editar, activar y desactivar |
| RF-DIR5 | El director debe generar reportes consolidados (ingresos, vencidas, egresadas, descartes, transfusiones, donantes) por rango de fechas y producto | Procesos (director) | Parcial | Hecho | reportes PDF consolidados |
| RF-DIR6 | El director debe consultar el registro de cambios realizados en los hemocomponentes | Páginas director | Parcial | Hecho | Bitácora de la sede (dirección); aplicada (27-11) |
| RF-DIR7 | El director debe registrar solicitudes de transfusión y ver las pendientes, resueltas y propias, con búsqueda y filtro por prioridad | Páginas director | Hecho | Cambió | por decisión del usuario, el operador registra la transfusión local sin aprobación |
| RF-DIR8 | El director debe aprobar o rechazar las solicitudes de hemocomponentes entre centros | Procesos (director) | Pendiente | Hecho | aprobar o rechazar pedidos entre centros |
| RF-DIR9 | El director debe poder editar su perfil | Páginas director | Hecho | Hecho |  |

## Soporte y administrador técnico

Soporte atiende al donante y el administrador técnico atiende al sistema; son roles distintos. Hoy solo existe el primero.

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-S1 | Soporte debe gestionar una bandeja de solicitudes: tomar, responder, resolver, marcar urgente y dejar notas internas | Doc G8 | Hecho | Hecho |  |
| RF-S2 | Soporte debe consultar a un donante en solo lectura, sin ver resultados médicos | Nuevo | Hecho | Hecho |  |
| RF-S3 | Soporte debe tener un dashboard con solicitudes sin resolver, sin asignar y propias | Nuevo | Hecho | Hecho |  |
| RF-S4 | El sistema debe medir el tiempo de primera respuesta y de resolución de cada solicitud | Nuevo | Pendiente | Hecho | tiempo de primera respuesta y de resolución por solicitud; medianas y meta de 24 h en el panel de soporte (27-11) |
| RF-A1 | El administrador técnico debe gestionar usuarios: alta, baja y restablecer acceso | Procesos (actores) | Pendiente | Hecho | /soporte/cuentas: activar, rol y sede, quitar 2FA, restablecer acceso; aplicada y probada (27-11) |
| RF-A2 | El administrador técnico debe registrar fallas del sistema e incidencias técnicas | Procesos (actores) | Pendiente | Hecho | /soporte/incidencias con seguimiento; aplicada y probada (27-11) |
| RF-A3 | El administrador técnico debe resolver incidencias de inventario, muestras y pruebas, corrigiendo estados con justificación | Procesos (actores) | Pendiente | Hecho | /soporte/correcciones con motivo e incidencia; aplicada y probada (27-11) |
| RF-A4 | El administrador técnico debe poder consultar la bitácora de auditoría (RF-T9) | Nuevo | Pendiente | Hecho | /soporte/bitacora (toda la red); aplicada (27-11) |

## Procesos de banco de sangre (M06–M09)

Estos cuatro módulos casi no existen todavía. Los plazos de caducidad y alerta salen del documento de procesos.

### Inventario y almacenamiento (RF-I)

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-I1 | Cada unidad debe tener un estado: cuarentena (por defecto al extraer), disponible, reservado, en tránsito, transfundido o descartado | Procesos M06 | Parcial | Parcial | estados en unidadsangre; falta «en tránsito» y «transfundido» explícitos |
| RF-I2 | Cada cambio de estado debe guardar fecha, hora y operador responsable | Procesos M06 | Pendiente | Parcial | bitácora de reservas, despachos y rechazos |
| RF-I3 | Cada unidad debe tener ubicación física: equipo (cámara, refrigerador, congelador, agitador), estante, gradilla y posición | Procesos M06 | Pendiente | Hecho | ubicación al fraccionar y al mover cada unidad desde el inventario (27-11) |
| RF-I4 | El sistema debe registrar la temperatura de los equipos, alertar fuera de rango y guardar la calibración de los sensores | Procesos M06 | Pendiente | Hecho | Equipos y temperatura (laboratorio y dirección); aplicada y probada (27-11) |
| RF-I5 | El sistema debe calcular la caducidad según el componente y alertar: 7 días antes en eritrocitos, 30 días antes en plasma y 48 horas antes en plaquetas | Procesos M04 | Pendiente | Hecho | alerta por componente: eritrocitos 7 días, plasma y crio 30, plaquetas 48 h (27-11) |
| RF-I6 | Las unidades deben asignarse por FIFO según la fecha de caducidad más cercana | Procesos M08 | Pendiente | Hecho | la base reserva por fecha de vencimiento más cercana (verificado 26-11) |
| RF-I7 | Cada baja debe registrar causa (caducidad, serología reactiva, rotura, alteración térmica, hemólisis), fecha, hora, método de disposición y firma del responsable | Procesos M06 | Parcial | Hecho | baja con causa, método de disposición y firma (BAJA_UNIDAD); la serología reactiva sigue siendo automática (27-11) |
| RF-I8 | El sistema debe mostrar el stock disponible por grupo sanguíneo y componente | Nuevo | Hecho | Hecho |  |

### Distribución y traslado (RF-DS)

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-DS1 | El sistema debe gestionar solicitudes e intercambio de hemocomponentes entre centros | Procesos M07 | Pendiente | Hecho | pedidos entre centros (pedido_entre_centros) |
| RF-DS2 | Cada despacho debe registrar centro emisor y receptor, transporte, chofer, fecha y hora | Procesos M07 | Parcial | Hecho | emisor, receptor, transporte, chofer, fecha y hora en el despacho entre centros (27-11) |
| RF-DS3 | Cada envío debe registrar contenedor isotérmico, data logger y lecturas de temperatura a la salida y a la llegada | Procesos M07 | Pendiente | Hecho | contenedor isotérmico, data logger y temperaturas de salida y de llegada (27-11) |
| RF-DS4 | Al recibir, el sistema debe registrar la verificación visual (hemólisis, coágulos, turbidez, burbujas, fugas) y confirmar la recepción | Procesos M07 | Pendiente | Hecho | inspección visual al recibir; con hallazgos las bolsas entran en cuarentena (27-11) |
| RF-DS5 | Antes del despacho, el sistema debe verificar brazalete, DIN y etiqueta de compatibilidad | Diagrama de procesos | Pendiente | Hecho | verificación de brazalete, DIN y etiqueta obligatoria antes del despacho local (VERIF_DESPACHO) (27-11) |

### Transfusión y solicitudes (RF-TR)

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-TR1 | El sistema debe recibir la solicitud clínica: centro, servicio, médico, diagnóstico, indicación, urgencia, y adjuntar la orden médica, la historia y el consentimiento | Procesos M08 | Parcial | Parcial | orden médica con datos clínicos y consentimiento; sin adjuntos |
| RF-TR2 | El laboratorio debe registrar la muestra del paciente con su grupo ABO, Rh y fenotipo extendido | Procesos M08 | Pendiente | Hecho | tipaje de la muestra del paciente |
| RF-TR3 | El laboratorio debe registrar pruebas cruzadas: Coombs directo e indirecto, prueba mayor y menor, con fecha, hora y firma del analista | Procesos M08 | Pendiente | Hecho | prueba cruzada mayor, menor y Coombs |
| RF-TR4 | El sistema debe reservar unidades y vincular el DIN con el ID del paciente según la urgencia (emergencia, urgente, programada) | Procesos M08 | Pendiente | Hecho | reserva de unidades vinculada a la solicitud y al paciente |
| RF-TR5 | El sistema debe proponer la asignación con IA, considerando edad, fenotipo, anticuerpos y necesidad de componentes desleucocitados | Procesos M08 | Pendiente | Pendiente | asignación propuesta por IA |
| RF-TR6 | Si la unidad es compatible, el sistema debe generar la etiqueta de compatibilidad y registrar la salida | Diagrama de procesos | Pendiente | Hecho | etiqueta de compatibilidad en PDF (10 × 7,5 cm) desde Compatibilidad y Despachos (27-11) |
| RF-TR7 | Si no es compatible, el sistema debe notificar al médico tratante | Diagrama de procesos | Pendiente | Hecho | incompatibles bloquean el despacho; lista con el médico tratante y registro del aviso (AVISO_MEDICO) (27-11) |

### Hemovigilancia (RF-H)

| ID | Requerimiento | Origen | Estado (20-10) | Estado (25-11) | Nota |
|---|---|---|---|---|---|
| RF-H1 | Antes de transfundir, el sistema debe exigir la doble verificación al lado de la cama: identidad y brazalete, DIN contra etiqueta, ABO/Rh del paciente contra la bolsa, vencimiento e inspección visual | Procesos M09 | Pendiente | Hecho | doble verificación obligatoria con segundo verificador; aplicada y probada (26-11) |
| RF-H2 | El sistema debe exigir el consentimiento informado firmado y la orden médica por escrito | Procesos M09 | Pendiente | Parcial | consentimiento en la solicitud y en la verificación; falta la orden escrita adjunta |
| RF-H3 | El sistema debe registrar el monitoreo: inicio antes de 30 min fuera de refrigeración, fin en máximo 4 horas, signos vitales y velocidad de infusión | Procesos M09 | Pendiente | Hecho | tiempos, volumen, velocidad y signos; alertas de 30 min desde el despacho y de 4 h de infusión (27-11) |
| RF-H4 | El sistema debe registrar reacciones adversas (categoría, hora, síntomas, acciones tomadas) y notificarlas al comité de hemovigilancia | Procesos M09 | Pendiente | Hecho | reacciones con categoría, severidad e imputabilidad; la dirección notifica al comité (HV_COMITE) (27-11) |
| RF-H5 | El sistema debe permitir la trazabilidad en ambos sentidos entre donante y receptor | Procesos M09 | Pendiente | Hecho | Trazabilidad (dirección y laboratorio); aplicada y probada (27-11) |
| RF-H6 | Si la transfusión se suspende o la bolsa se rechaza, el sistema debe registrar la devolución y notificar al banco de sangre | Diagrama de procesos | Pendiente | Hecho | devolución de la bolsa al suspender o rechazar; el laboratorio confirma la recepción (27-11) |

## No funcionales y decisiones abiertas

Siete decisiones bloquean el alcance de varios requerimientos; las tres primeras son las que más pesan.

### Decisiones abiertas

1. **Quién registra la solicitud de transfusión.** Hoy vive en el director (RF-DIR7), pero el diagrama la sitúa en las clínicas externas; define si es un portal propio o se queda con el director.
2. **Quién crea cuentas.** RF-DIR4 (director) y RF-A1 (administrador técnico) se solapan. *Decidido el 25-11-2026: los dos; el director con el personal de su sede y soporte con cualquier cuenta de la red, ambos con registro en la bitácora.*
3. **Soporte y administrador técnico.** El documento de procesos define al técnico; el de requerimientos define a soporte. Confirma si son dos roles. *Decidido: un solo rol, soporte.*
4. **Malaria.** El panel de pruebas la incluye y el documento no la pide.
5. **Caducidad del plasma.** El texto dice 1 a 3 años y la tabla dice 12 meses a −25 °C y 24 meses a −30 °C.
6. **Intervalo entre donaciones.** El documento lo define por sexo y tipo de extracción sin dar los valores; hoy se usan 90 días fijos.
7. **Chat en tiempo real entre personal.** Ningún requerimiento lo pide, y el chatbot (RF-T7) ya cubre la guía; define si se retoma.

### No funcionales clave

- **Privacidad clínica:** los resultados de laboratorio nunca se muestran al donante, a soporte ni al operador; el operador solo ve que el donante está diferido.
- **Datos en servidor:** hoy todo vive en el navegador (localStorage); debe pasar a una base de datos con autenticación real antes de usarse en un centro.
- **Trazabilidad:** todo DIN, hemocomponente y movimiento debe poder rastrearse hasta el donante y el receptor (RF-H5).
- **Estándar:** códigos de donación y de producto según ISBT-128.
- **Uso en móvil y escritorio:** todas las pantallas deben funcionar en ambos y ser accesibles por teclado.
- **Idioma y formato:** español de Venezuela, fechas día/mes/año.
