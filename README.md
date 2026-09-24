# BLUD

Red de donación de sangre en tiempo real. Conecta donantes voluntarios con pacientes, bancos de sangre y centros de salud en Maracaibo y San Francisco (Zulia).

Construido con [Astro](https://astro.build) y Tailwind CSS v4.

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
│   ├── eligibility/   # Test de elegibilidad (20 preguntas)
│   ├── info/          # Plantilla de las páginas de Infórmate
│   ├── landing/       # Secciones de la página principal
│   ├── Icon.astro     # Íconos Phosphor (ver src/lib/icons.ts)
│   ├── LegalPage.astro
│   ├── Logo.astro
│   ├── Navbar.astro
│   └── Footer.astro
├── data/
│   ├── eligibility.ts # Preguntas del test de elegibilidad
│   └── info.ts        # Temas de Infórmate (menú, índice y footer)
├── lib/
│   ├── forms.ts       # Validación y estados de envío compartidos
│   └── icons.ts       # Registro de íconos
├── layouts/Layout.astro
├── pages/             # index, elegibilidad, informate/*, login, register, recuperar, privacidad, terminos, 404
└── styles/global.css  # Tokens de diseño (tema claro y oscuro)
```

## Sistema de diseño

- **Tipografía:** Schibsted Grotesk (texto y titulares) y Geist Mono (datos), autoalojadas con Fontsource.
- **Color:** un solo acento, el rojo de marca `#CA2B2B`. Superficies y textos usan tokens semánticos (`bg-canvas`, `bg-surface`, `text-ink`, `text-ink-2`, `border-line`...) definidos en `global.css`, con valores para tema claro y oscuro. No uses colores `slate-*` ni hex sueltos en los componentes.
- **Tema:** sigue la preferencia del sistema; el botón de la barra superior alterna claro u oscuro (se guarda en `localStorage`).
- **Radios:** controles (botones, inputs, chips) `rounded-control` (12px); paneles e imágenes `rounded-panel` (20px).
- **Componentes base:** `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-on-night`, `.field`, `.panel`, `.section-title`, `.section-lead`, `.link-arrow`.
- **Movimiento:** añade `data-reveal` para que un elemento aparezca al entrar en pantalla. Todo respeta `prefers-reduced-motion`.

## Pendiente

- Las solicitudes urgentes, los centros y los formularios usan datos de ejemplo; falta conectarlos a la API.
- Definir `site` en `astro.config.mjs` para que se genere el sitemap y las URLs canónicas sean absolutas.
- Los textos de privacidad y términos son un borrador para revisión legal.
