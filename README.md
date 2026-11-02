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

Sin variables de Supabase, el sitio funciona en **modo demo**: cuentas, citas y paneles viven en el navegador (`localStorage`) y el personal arranca con datos de ejemplo. Para guardar los datos de verdad:

1. Aplica el esquema y los datos de ejemplo en el proyecto (SQL Editor, o `supabase db push` y luego `supabase/seed.sql`):
   `supabase/migrations/20261102000000_blud_esquema.sql` y `supabase/seed.sql`.
2. Despliega la función que crea las cuentas del personal: `supabase functions deploy crear-personal`.
3. Añade `PUBLIC_SUPABASE_URL` y `PUBLIC_SUPABASE_ANON_KEY` en `.env` y en Vercel, y vuelve a desplegar.

Con la base conectada, `localStorage` queda solo como caché y quién ve qué lo deciden las reglas RLS de la base, no el navegador:

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
