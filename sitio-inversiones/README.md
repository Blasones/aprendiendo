# Sitio Inversiones · Cartera de Oportunidades de Inversión Extranjera (Guantánamo, FIHAV 2026)

Sitio web estático de una sola página (`index.html`), sin dependencias externas, generado a partir
del PDF "Cartera de Oportunidades de Inversión Extranjera — Provincia Guantánamo".

## Idiomas

- **Español** — contenido completo (11 proyectos con monto, entidad y fundamentación).
- **English** — full content (11 projects with amount, entity and rationale).
- **Français** — resumen ( síntesis + tabla de los 11 proyectos + contacto).
- **中文** — 摘要（概述 + 11 个项目一览表 + 联系方式）.

El cambio de idioma se hace con las pestañas superiores (JavaScript básico, sin frameworks).

## Cómo verlo

Abrir `index.html` directamente en el navegador, o servir la carpeta:

```bash
cd sitio-inversiones
python3 -m http.server 8000
# http://localhost:8000
```

## Estructura

- `index.html` — sitio completo (HTML + CSS + JS embebidos).
