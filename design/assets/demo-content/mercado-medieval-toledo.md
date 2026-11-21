# Mercado Medieval de Toledo 2026 (demo event, slice 33a)

Fictional demo event. Content language: Spanish (`es`), like `fiestas-la-alameda`.

## Source of truth
The seed-ready content (event, 10 points, 17 sessions) is
`design/assets/demo-maps-ai/mercado-medieval-toledo.points.json`, in the same format as the other demo seeds.
It passes `loadSeed` + `resolveSessions` from `apps/api/scripts/seed-lib.ts`. Edit that file, not this one.

## Event
- **Slug:** `mercado-medieval-toledo`
- **Name:** Mercado Medieval de Toledo 2026
- **City / country:** Toledo, ES (39.86, -4.02), `Europe/Madrid`, map theme `light`
- **Dates in the file:** Fri 2026-12-11 to Sun 2026-12-13 (3 days). Re-dated by slice 39 only if the slug is added to `DEMO_PLACEMENTS`.
- **Short description (180 chars, not in the seed schema):**
  > Tres días en el casco histórico con más de 40 puestos de artesanos, mesones con asados y dulces, cetrería, justas a caballo, talleres de oficios y música en directo. Entrada libre.

## Points (x, y = fraction of the map image, origin top-left)
| id | name | category | x | y |
|---|---|---|---|---|
| puerta-vieja | Puerta Vieja de la Muralla | entrance-exit | 0.5236 | 0.8492 |
| catedral | Catedral | landmark | 0.5888 | 0.2242 |
| claustro-oficios | Claustro de los Oficios | landmark | 0.4121 | 0.1664 |
| palenque | Palenque del Torneo | stage | 0.2627 | 0.2989 |
| escenario-plaza | Escenario de la Plaza | stage | 0.7808 | 0.4755 |
| calle-artesanos | Calle de los Artesanos | merch | 0.2989 | 0.4959 |
| meson-zoco | Mesón del Zoco | food | 0.2717 | 0.7541 |
| informacion | Punto de información | info | 0.2944 | 0.8458 |
| aseos | Aseos | toilets | 0.6703 | 0.6929 |
| puesto-sanitario | Puesto sanitario | first-aid | 0.7473 | 0.574 |

Sessions sit only on `stage` and `landmark` points (the panel rule in `panel-sessions.ts`).

## Images
- **Map:** `design/assets/demo-maps-ai/mercado-medieval-toledo.webp`, 1104x1472 (3:4), WebP q80, 214 KB, no metadata.
  Qwen-Image via HF Space `mcp-tools/Qwen-Image` (Apache 2.0), seed 3301 (randomize off), 16 steps, guidance 4.
  Seed 4402 rejected (busier, more saturated, less like the cream-paper fiesta map).
  Retouch: a small notice with illegible scribbles on the blue roof of the info booth was filled with the roof blue
  (about 35x30 px). Pennants have small illegible marks, left as they are (same rule as `havnelobet`).
- **Cover:** `design/assets/event-covers/mercado-medieval-toledo.webp`, 960x640, WebP q80, 44 KB, no metadata.
  Same Space, seed 1201, 3:2 (1584x1056 output), 16 steps, guidance 4, demo-cover negative prompt; downscaled with Lanczos.
  Retouch: a fake signature in the bottom-right sand was covered with a sand patch from its left.
- Prompts: see the slice 33a reply from the designer (recorded by the archivist in the slice spec).
