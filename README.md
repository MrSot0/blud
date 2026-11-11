# BLUD

Red de donación de sangre en tiempo real. Conecta donantes voluntarios con pacientes, bancos de sangre y centros de salud en Maracaibo y San Francisco (Zulia).

Construido con [Astro](https://astro.build) y Tailwind CSS v4. ......

## Comandos

| Comando           | Acción                                       |
| :---------------- | :------------------------------------------- |
| `npm install`     | Instala las dependencias                     |
| `npm run dev`     | Servidor de desarrollo en `localhost:4321`   |
| `npm run build`   | Genera el sitio estático en `./dist/`        |
| `npm run preview` | Sirve la build localmente                    |

## Estructura

```text
src/
├── components/
│   ├── auth/          # Shell, campo de contraseña y botón de envío de login/registro
│   ├── centers/       # Tarjeta de centro y diálogo «Agendar aquí»
│   ├── eligibility/   # Test de elegibilidad (20 preguntas)
│   ├── info/          # Plantilla de las páginas de Infórmate
│   ├── landing/       # Secciones de la página principal
│   ├── Assistant.astro # Chat de Bluddie, el asistente de IA
│   ├── Icon.astro     # Íconos Phosphor (ver src/lib/icons.ts)
│   ├── LegalPage.astro
│   ├── Logo.astro
│   ├── Navbar.astro
│   └── Footer.astro
├── data/
│   ├── centers.ts     # Centros de salud (portada y /centros)
│   ├── eligibility.ts # Preguntas del test de elegibilidad
│   └── info.ts        # Temas de Infórmate (menú, índice y footer)
├── lib/
│   ├── auth.ts        # Cuentas, sesión y citas de demostración (localStorage)
│   ├── forms.ts       # Validación y estados de envío compartidos
│   ├── icons.ts       # Registro de íconos
│   └── map.ts         # Utilidades de Leaflet compartidas
├── layouts/Layout.astro
├── pages/             # api/chat (servidor), index, centros, elegibilidad, informate/*, login, register, recuperar, privacidad, terminos, 404
└── styles/global.css  # Tokens de diseño (tema claro y oscuro)
```

## Sistema de diseño

- **Tipografía:** Schibsted Grotesk (texto y titulares) y Geist Mono (datos), autoalojadas con Fontsource.
- **Color:** un solo acento, el rojo de marca `#CA2B2B`. Superficies y textos usan tokens semánticos (`bg-canvas`, `bg-surface`, `text-ink`, `text-ink-2`, `border-line`...) definidos en `global.css`, con valores para tema claro y oscuro. No uses colores `slate-*` ni hex sueltos en los componentes.
- **Tema:** sigue la preferencia del sistema; el botón de la barra superior alterna claro u oscuro (se guarda en `localStorage`).
- **Radios:** controles (botones, inputs, chips) `rounded-control` (12px); paneles e imágenes `rounded-panel` (20px).
- **Componentes base:** `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-on-night`, `.field`, `.panel`, `.section-title`, `.section-lead`, `.link-arrow`.
- **Movimiento:** añade `data-reveal` para que un elemento aparezca al entrar en pantalla. Todo respeta `prefers-reduced-motion`.

## Asistente Bluddie (Gemini)

Bluddie responde con **Gemini 3.1 Flash-Lite** (con reintento en 3.5 Flash-Lite) a través de `src/pages/api/chat.ts`, que se ejecuta en Vercel para que la clave nunca llegue al navegador. El resto del sitio sigue siendo estático.

1. Crea una clave en [Google AI Studio](https://aistudio.google.com/apikey).
2. En local, copia `.env.example` a `.env` y pega la clave en `GEMINI_API_KEY`.
3. En Vercel, añade la variable `GEMINI_API_KEY` (Settings → Environment Variables) y vuelve a desplegar.

Sin clave, el chat muestra un aviso en lugar de fallar.

## Base de datos (Supabase)

Sin variables de Supabase, el sitio funciona en **modo demo**: cuentas, citas y paneles viven en el navegador (`localStorage`) y el personal arranca con datos de ejemplo.

Con base real, el sitio usa el esquema del proyecto **Bloodonor** (`usuario`, `donante`, `donacion`, `unidadsangre`, `solicitudtransfusion`, `prueba_serologica`…) y sus funciones de negocio (`evaluar_donante`, `registrar_donacion`, `reservar_unidades`…). [`supabase/migrations/20261102120000_blud_adaptador.sql`](supabase/migrations/20261102120000_blud_adaptador.sql) solo añade una capa de traducción, sin cambiar sus tablas ni funciones:

- `blud_panel()` devuelve lo que el rol puede ver, con la forma de las colecciones del front.
- `blud_guardar(coleccion, item)` aplica cada cambio con las funciones del esquema, que validan rol y reglas clínicas.

Para conectarlo:

1. En el SQL Editor de Bloodonor, ejecuta las migraciones en orden (`20261102120000_blud_adaptador.sql` y [`20261111120000_blud_carnet_citas.sql`](supabase/migrations/20261111120000_blud_carnet_citas.sql) y [`20261111150000_blud_carnet_publico.sql`](supabase/migrations/20261111150000_blud_carnet_publico.sql)) y luego [`supabase/seed.sql`](supabase/seed.sql) (cuentas y datos de ejemplo; todo se puede repetir).
2. Despliega la función que crea las cuentas del personal: `supabase functions deploy crear-personal --project-ref flcuenjrgnlhbfmqpgav`.
3. Añade `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` (la clave publicable) en `.env.local` y en Vercel, y vuelve a desplegar.

Pruebas por rol: [`supabase/tests/adaptador.sql`](supabase/tests/adaptador.sql), sobre una copia de la base, después de la migración y el seed. Termina con un error a propósito para que todo se revierta; el mensaje trae los resultados.

La segunda migración añade el carnet con foto y la ficha del QR:

- `fotos-donantes`: bucket privado de Storage. Cada donante solo sube y ve su carpeta; el personal puede ver todas.
- `blud_mi_ficha()`: los datos del donante tal como están en la base (rellenan su perfil y su carnet).
- `blud_donante_ficha(q)`: el personal consulta un donante por el QR, el ID `BLD-000123` o la cédula.
- `blud_cancelar_cita(id)`: el donante cancela su cita.

El QR del carnet es un enlace a `/verificar?id=BLD-000123&t=<código>`. Cualquier persona que lo escanee ve el carnet público: foto, nombre, cédula, ID, teléfono y tipo de sangre (`blud_carnet_publico`, que exige el código secreto del QR para que nadie pueda recorrer los IDs). El personal con sesión iniciada ve además nacimiento, sexo, correo, donaciones y próxima cita. Las fotos del bucket `fotos-donantes` se leen por enlace; solo el dueño puede subirlas o borrarlas. Un donante no puede agendar hasta tener foto, nombres, apellidos, cédula, teléfono, fecha de nacimiento, sexo y tipo de sangre guardados (en `/donante/donar` ve lo que le falta). Sus citas están en `/donante/citas`.

Con la base conectada, `localStorage` queda solo como caché. El esquema exige datos que el modo demo no pide: sexo y fecha de nacimiento del donante, signos vitales antes de la extracción, e indicación clínica y consentimiento en la orden médica.

| Rol         | Ve                                                         | Puede                                                                                          |
| :---------- | :--------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| donante     | su registro, sus donaciones, sus citas y tickets           | pre-registrarse, agendar citas, abrir tickets                                                  |
| operador    | donantes, donaciones, inventario, solicitudes y entregas   | registrar donaciones (entran en cuarentena), cargar solicitudes (quedan por aprobar), despachar |
| laboratorio | donantes, donaciones, pruebas, fracciones y casos          | registrar pruebas, liberar o descartar unidades, fraccionar                                    |
| soporte     | tickets y notas internas                                   | responder y cerrar tickets                                                                     |
| dirección   | todo, salvo el detalle del laboratorio (recibe un resumen) | aprobar o rechazar solicitudes, crear y desactivar cuentas del personal                        |

Nadie puede darse otro rol: lo asigna la dirección y lo protege la base.

## Cuentas de prueba

Funcionan igual en modo demo y con Supabase (las crea `supabase/seed.sql`):

| Rol         | Correo                 | Contraseña        |
| :---------- | :--------------------- | :---------------- |
| dirección   | `maria@blud.app`       | `Donante2026`     |
| donante     | `carlos@blud.app`      | `Sangre2026`      |
| operador    | `operador@blud.app`    | `Operador2026`    |
| laboratorio | `laboratorio@blud.app` | `Laboratorio2026` |
| soporte     | `soporte@blud.app`     | `Soporte2026`     |

Cambia estas contraseñas (o borra las cuentas) antes de usar la base con datos reales.

## Pendiente

- Las solicitudes urgentes y los centros (teléfonos ficticios, coordenadas aproximadas) usan datos de ejemplo.
- Los textos de privacidad y términos son un borrador para revisión legal.
