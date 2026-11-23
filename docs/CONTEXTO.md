# BLUD · Contexto del proyecto para continuar en otra sesión

Documento de traspaso. Resume decisiones, estado y forma de trabajo acordados con el dueño del proyecto
hasta el commit `f9050dc` (20-11-2026). Léelo completo antes de cambiar algo.

## 1. Qué es y dónde vive

- **BLUD**: red de donación de sangre del Zulia (Venezuela). Astro 7 + Tailwind v4 + TypeScript, sitio estático
  con una ruta de servidor (`/api/chat`, Gemini). Repositorio `MrSot0/blud`.
- **Producción**: Vercel, https://blud-khaki.vercel.app (despliega solo desde `main`).
- **Base**: Supabase, proyecto «Bloodonor», id `flcuenjrgnlhbfmqpgav`.
  Variables públicas (también en Vercel): `PUBLIC_SUPABASE_URL=https://flcuenjrgnlhbfmqpgav.supabase.co`,
  `PUBLIC_SUPABASE_ANON_KEY=sb_publishable_BJDltybWY7KGoP9cQUbdUA_nuyFICFK`. Sin `.env` el sitio corre en **modo demo**
  (todo en `localStorage`). Para probar con la base real crea `.env` con esas dos líneas (está en `.gitignore`).
- **Requerimientos**: «BLUD – Requerimientos funcionales unificados.docx» (92 RF, versión del 11-11-2026; no cambió).
  Grupos: RF-T (transversales), D (donante), O (operador), L (laboratorio), DIR (director), S (soporte),
  A (administrador técnico = **soporte**, mismo rol), I (inventario), DS (despacho), TR (transfusión), H (hemovigilancia).

## 2. Forma de trabajo acordada

- **Idioma**: el usuario escribe en español; responder en español. Textos de la app en español de Venezuela.
- **Sin «AI slop»**: nada de emojis en la interfaz; textos sobrios.
- **Ramas**: se trabaja en `claude/festive-dijkstra-cnt0hw` y el usuario pidió **subir directo a `main`**:
  commit → `git push -u origin <rama>` → si es avance rápido, `git push origin HEAD:main`.
- **Commits**: mensaje en español; terminar con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` y la línea `Claude-Session:` de la sesión.
- **Migraciones**: cada cambio de base en `supabase/migrations/AAAAMMDDhhmmss_blud_<tema>.sql` y aplicado con la
  herramienta MCP `apply_migration` (nombre sin fecha). Escribir migraciones idempotentes («se puede repetir»).
- **Parches a funciones grandes** (`blud_panel`, `evaluar_donante`, `blud_transfusiones`…): no reescribirlas;
  reemplazo dinámico `pg_get_functiondef` + `replace` + `execute`, leyendo la definición justo antes.
- **Diseño**: tokens propios (`bg-sunken`, `text-ink`, `accent`, `ok`, `warn`…), componentes `panel`, `btn`,
  `field`, y utilidades móviles de `src/styles/global.css`: `page-head`, `page-head-acciones`, `chips-scroll`,
  `form-grid` (+ `col-full`), `tabla-apilable` (+ `celda-titulo`, `celda-ancha`, `celda-acciones`, `celda-estado`,
  `celda-corta`, `celda-movil-oculta`, `data-label` en cada `<td>`), y el componente `components/app/Filtros.astro`
  (filtros plegables «Filtros (n)» en móvil). Todo debe verse bien a 390 px.
- **Estilos para HTML generado por JS**: los `<style>` de Astro son locales; para nodos creados en el cliente usar
  `<style is:global>` con un prefijo de página (ej. `[data-estadisticas] …`).

## 3. Arquitectura de datos

- Lectura: `blud_panel()` llena la caché local (`localStorage`, colecciones `blud-db-*`), acotada al **último año**
  (tickets abiertos o con movimiento en 90 días). Escritura: `blud_guardar(coleccion, item)` → `private.g_*`.
  `src/lib/supabase.ts` (`sincronizar`, `subir`), `src/lib/db.ts` (colecciones, `onDb`, `cachear`).
- Paginación: `blud_pagina(...)` por cursor (donaciones, donantes, pruebas, fraccionamientos, tickets) +
  `src/lib/paginacion.ts` y `components/app/Paginador.astro` («Mostrar más» / «Ver registros anteriores»).
- Identidad: `public._uid()`, `public.mi_rol()` (devuelven null si la cuenta tiene 2FA y el JWT no es `aal2`),
  `public._sede_id()` (sede del personal), `public._exigir_rol(array[...])`.
- RPC por dominio: citas (`blud_agendar_cita`, `blud_bandeja_citas(p_dias, p_sede)`, `blud_cita_marcar`),
  ficha/carnet (`blud_donante_ficha`, `blud_carnet_publico`), transfusión (`blud_transfusiones`,
  `blud_registrar_tipaje`, `blud_registrar_cruzada`, `blud_cambiar_unidad`), sedes (`blud_sedes_mapa`, pública),
  pedidos entre centros (tabla `pedido_entre_centros`, ver migración `20261120100000`).
- Chat en tiempo real con Supabase Realtime Broadcast (canales privados), **nunca** en localStorage.
- DIN ISBT 128 en `donacion.din_isbt` (FIN por sede en `sede.fin_isbt`, `V0001`…).

## 4. Flujos vigentes por rol (decisiones del usuario)

- **Donante**: registro con confirmación de correo → perfil completo obligatorio para donar → cuestionario de salud
  por partes → agenda cita en una sede del mapa → carnet con QR (vista pública con token) → chat con el banco.
- **Operador** (menú: Panel · Donación: Citas del centro, Donantes, Donaciones · Transfusión: Solicitar transfusión,
  Despachos, Hemovigilancia · Seguimiento: Mensajes, Historial):
  1. **Citas del centro**: bandeja de citas de su sede (Llegó → En espera → Atender/No asistió). La cita se cierra
     sola al guardar donación (Atendida) o evaluación no apta (No apto) por triggers. Selector de sede: otras sedes
     y «Toda la red» en solo lectura.
  2. **Donantes**: escanear QR con cámara (jsQR/BarcodeDetector), buscar por cédula/ID/nombre; todo abre la misma
     ficha del carnet (`FichaDonante`).
  3. **Donaciones**: evaluación médica obligatoria (O7) + extracción (O8) → cuarentena con DIN.
  4. **Transfusión local**: el operador la registra, **sin aprobación de la dirección**; se reservan unidades de su
     sede; laboratorio hace tipaje y prueba cruzada; el operador despacha. Sin stock: «En espera de stock».
- **Laboratorio**: tamizaje, fraccionamiento, positivos, **Compatibilidad** (tipaje + cruzada), reportes, registros.
- **Director** (menú: Panel, Solicitudes entre centros · Banco de sangre: Inventario, Hemovigilancia, Mapa de calor,
  Reportes · Gestión: Personal): **solo aprueba pedidos de hemocomponentes entre centros**. El director que
  necesita bolsas pide a otro centro; el director del centro proveedor aprueba/rechaza; su operador despacha; el
  solicitante confirma la recepción. No aprueba lo que registra el operador.
- **Soporte = administrador técnico**: bandeja de tickets, consulta de donantes en solo lectura, chat.

## 5. Cuentas de prueba (en `src/lib/auth.ts`, selector del login)

| Correo | Clave | Rol | Notas |
|---|---|---|---|
| maria@blud.app | Donante2026 | director | sin 2FA, sede 2 |
| operador@blud.app | Operador2026 | operador | **2FA activado** (no se puede entrar en pruebas automáticas) |
| laboratorio@blud.app | Laboratorio2026 | laboratorio | sede 2 |
| soporte@blud.app | Soporte2026 | soporte | sede 2 |
| carlos@blud.app | Sangre2026 | donante | |
| prueba@blud.app | Prueba2026 | donante | |

Todo el personal está en la sede 2 «Banco de Sangre del Zulia». La sede 1 «Hospital Central Maracaibo» no está en el
mapa y tiene `recibe_citas = false` (guarda datos históricos). Las cuentas duplicadas `@blud.test` del personal se
fusionaron en las `@blud.app` y se borraron; quedan 6 donantes de ejemplo `@blud.test`.

## 6. Cómo probar

- Servidor: `npx astro dev --background` (si falla con «504 Outdated Optimize Dep»: `npx astro dev stop;
  rm -rf node_modules/.vite` y volver a iniciar). Ojo: `astro dev status` dice «No dev server is running»,
  que también contiene «running».
- Navegador: Playwright con Chromium preinstalado (`require('playwright')`), `devices['iPhone 13']` para móvil.
- SQL como un usuario: dentro de `begin … rollback`, `set_config('request.jwt.claims', json_build_object('sub', <id>,
  'email', <correo>, 'role', 'authenticated', 'aal', 'aal2')::text, true)` y `set local role authenticated`.
- Build: `npm run build`. Tipos: `npx -y -p typescript@5.9.3 tsc --noEmit --skipLibCheck --module esnext
  --moduleResolution bundler --target es2022 --strict --types vite/client --lib es2022,dom,dom.iterable <archivos>`.
- PDF: se generan en el navegador con `pdf-lib` (`src/lib/pdf.ts` kit con logo vectorial; `src/lib/reportes-pdf.ts`
  un PDF por reporte). Para revisarlos: descargarlos con Playwright y `pdftoppm -png`.

## 7. Hecho recientemente (de más nuevo a más viejo)

- Índices de `pedido_entre_centros` (`f9050dc`).
- Rendimiento: índices (34 FK sin índice → 0), RLS con `(select auth.jwt())`, `blud_panel` acotado, `blud_pagina`,
  paginador en todos los roles. Panel por rol de ~450 ms/1 MB a ~190 ms/480 KB (`08b7a5f`).
- Flujo de solicitudes nuevo (local sin aprobación; pedidos entre centros) (`7c9eadb`).
- Mapa de calor geográfico con `leaflet.heat` (+ matriz centro × periodo, ranking, resumen y PDF) (`953a2fd`, `13695d6`).
- PDF con marca BLUD: estadísticas, consolidado, inventario, solicitudes/pedidos, comprobante, hemovigilancia,
  personal y constancia de acceso (`13695d6`).
- Diseño móvil de todos los frames del director (`29bd5de`).
- Citas del centro con selector de sede; bandeja de citas; Donantes unificado con el QR (`f4dada2`, `a393645`).
- Fases 1 y 2: evaluación/extracción/DIN y compatibilidad (`b36ff26`, `37546e0`).

## 8. Pendiente (orden recomendado)

1. **Hemovigilancia real (H1, H2, H4)**: hoy no guarda nada. `operador/hemovigilancia.astro` usa datos fijos y
   `director/hemovigilancia.astro` es una maqueta (sedes inventadas; su PDF imprime esos datos). Tabla
   `hemo_vigilancia` vacía. Idea: registrar desde el despacho (unidad despachada → doble verificación, signos,
   reacciones) y que el director consulte.
2. **Bitácora y administrador técnico (T9, I2, A1–A4, T3)**: 227 filas en `bitacora_auditoria` sin pantalla;
   activar/desactivar cuentas y restablecer acceso, incidencias, corrección de estados con justificación (en soporte).
3. **Pantallas transversales que faltan** (pendiente que el usuario confirme cuáles):
   operador (Ayuda a soporte, notificaciones), laboratorio (Mensajes, Ayuda, Notificaciones), director (Mensajes
   entre directores, Historial/bitácora, Ayuda, avisos de pedidos entrantes), soporte (Historial).
4. **Sedes desde la base**: `/centros`, Donar y el diálogo de agendar aún usan `src/data/centers.ts`; la cita se
   enlaza por nombre (`blud_agendar_cita`); no se validan horario ni cupos en el servidor.
5. Contador en el menú del operador para pedidos por despachar/recibir; agregación en servidor para rangos > 1 año
   (mapa de calor «Todo», reportes); notas internas de tickets antiguos; triggers lentos en inserciones masivas.
6. **Avisos por correo (T10, D8)**: requieren configurar SMTP en Supabase (las plantillas `supabase/templates/`
   ya existen y necesitan SMTP para editarse). Decidir si la 2FA será obligatoria para el personal.

Detalle completo de la revisión de roles: [`docs/revision-roles.md`](./revision-roles.md).
