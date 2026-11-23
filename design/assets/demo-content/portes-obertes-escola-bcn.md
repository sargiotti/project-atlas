# Jornada de portes obertes 2026 · Escola Turó dels Plàtans (demo event, slice 33b)

Fictional demo event and fictional school. Content language: Catalan (`ca`).

## Source of truth
The seed-ready content (event, 10 points, 10 sessions) is
`design/assets/demo-maps-ai/portes-obertes-escola-bcn.points.json`, in the same format as the other demo seeds.
It passes `loadSeed` + `resolveSessions` from `apps/api/scripts/seed-lib.ts`. Edit that file, not this one.

## Event
- **Slug:** `portes-obertes-escola-bcn`
- **Name:** Jornada de portes obertes 2026 · Escola Turó dels Plàtans
- **City / country:** Barcelona, ES (41.39, 2.17), `Europe/Madrid`, map theme `light`
- **Dates in the file:** 2026-12-12 (1 day), 10:00 to 14:00.
  PO decision: `DEMO_PLACEMENTS` slot `coming-up`, which re-dates the event and moves its weekday.
  For that reason no text (points, sessions, descriptions) names a weekday.
- **Short description (not in the seed schema):**
  > Un matí per conèixer l'escola, d'infantil a l'ESO: visites guiades, demostracions al laboratori, contacontes, esport, la coral i un taller de dibuix per a tota la família.

## Points (x, y = fraction of the map image, origin top-left)
| id | name | category | x | y |
|---|---|---|---|---|
| porta | Porta principal | entrance-exit | 0.4964 | 0.8322 |
| recepcio | Recepció i informació | info | 0.5299 | 0.8832 |
| sala-actes | Sala d'actes | stage | 0.5344 | 0.3193 |
| gimnas | Gimnàs | landmark | 0.7428 | 0.4416 |
| laboratori | Laboratori de ciències | landmark | 0.1947 | 0.5503 |
| biblioteca | Biblioteca | landmark | 0.2491 | 0.4925 |
| aula-plastica | Racó de dibuix al pati | landmark | 0.5634 | 0.6793 |
| menjador | Menjador | food | 0.2083 | 0.8016 |
| lavabos | Lavabos | toilets | 0.9149 | 0.7269 |
| primers-auxilis | Primers auxilis | first-aid | 0.8197 | 0.7880 |

`aula-plastica` keeps its id but is named "Racó de dibuix al pati": the map shows the easels outdoors in the playground, not an art room.
Sessions sit only on `stage` and `landmark` points (the panel rule in `panel-sessions.ts`).

## Sessions (all on 2026-12-12)
| time | title | point |
|---|---|---|
| 10:00–10:45 | Benvinguda i presentació del projecte educatiu | sala-actes |
| 10:30–13:30 | Taller obert de dibuix per a famílies | aula-plastica |
| 10:45–11:30 | Visita guiada: grup 1 | sala-actes |
| 11:00–11:30 | Demostració al laboratori: volcans i cristalls | laboratori |
| 11:00–11:30 | Contacontes per als més petits | biblioteca |
| 11:30–12:15 | Exhibició esportiva: bàsquet i gimnàstica rítmica | gimnas |
| 12:00–12:45 | Visita guiada: grup 2 | sala-actes |
| 12:30–13:00 | Demostració al laboratori: volcans i cristalls | laboratori |
| 12:45–13:15 | Concert de la coral de l'escola | sala-actes |
| 13:15–14:00 | Preguntes i respostes amb el professorat | biblioteca |

## Images
- **Map:** `design/assets/demo-maps-ai/portes-obertes-escola-bcn.webp`, 1104x1472 (3:4), WebP q80, 122 KB, no metadata.
  Qwen-Image via HF Space `mcp-tools/Qwen-Image` (Apache 2.0), seed 3301 (randomize off), 16 steps, guidance 4, demo-map negative prompt.
  Seed 4402 was also generated and rejected: buildings float apart, the bottom edge has stray fragments, less cohesive than 3301.
  Retouch: a stray green "glider" shape on a pole at the right edge of the green court (about 160x110 px) was repainted
  with the court green, the white sideline and the cream ground along the court edge.
  No tint: the generated ground is already cream (255, 253, 234), the same as Toledo.
  No legible text in the image (the reception sign is blank).
- **Cover:** `design/assets/event-covers/portes-obertes-escola-bcn.webp`, 960x640, WebP q80, 43 KB, no metadata.
  Same Space, seed 1201, 3:2 (1584x1056 output), 16 steps, guidance 4, demo-cover negative prompt; downscaled with Lanczos.
  Retouch: the flag on the bell gable was removed (replaced with sky, so the cover carries no national or regional flag),
  and a fake signature in the bottom-right sand was covered with a sand patch from its left.
