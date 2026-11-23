# Lisboa Tech Summit 2026 (demo event, slice 33b)

Fictional demo event. Content language: English (`en`).

## Source of truth
The seed-ready content (event, 10 points, 14 sessions) is
`design/assets/demo-maps-ai/lisboa-tech-summit.points.json`, in the same format as the other demo seeds.
It passes `loadSeed` + `resolveSessions` from `apps/api/scripts/seed-lib.ts`. Edit that file, not this one.

## Event
- **Slug:** `lisboa-tech-summit`
- **Name:** Lisboa Tech Summit 2026
- **City / country:** Lisbon, PT (38.70, -9.17), `Europe/Lisbon`, map theme `light`
- **Dates in the file:** Thu 2026-12-10 to Fri 2026-12-11 (2 days). Re-dated by slice 39 only if the slug is added to `DEMO_PLACEMENTS`.
- **Short description (not in the seed schema):**
  > Two days of talks, workshops and demos in the old riverside docks by the Tagus. Keynotes, two talk rooms, a 30-stand expo hall, lunch included and a closing party.

## Points (x, y = fraction of the map image, origin top-left)
| id | name | category | x | y |
|---|---|---|---|---|
| main-stage | Main Stage – Warehouse 1 | stage | 0.4348 | 0.2717 |
| room-a | Room A – Tile House | stage | 0.0861 | 0.3804 |
| room-b | Room B – Cork House | stage | 0.1721 | 0.4755 |
| expo-hall | Expo Hall | landmark | 0.5072 | 0.5231 |
| river-terrace | River Terrace | drinks | 0.8062 | 0.4144 |
| food-court | Food Court | food | 0.5435 | 0.6861 |
| registration | Registration Desk | info | 0.8424 | 0.8573 |
| main-gate | Main Gate | entrance-exit | 0.5254 | 0.8764 |
| toilets | Toilets | toilets | 0.6929 | 0.9035 |
| first-aid | First Aid | first-aid | 0.8333 | 0.6148 |

Sessions sit only on `stage` and `landmark` points (the panel rule in `panel-sessions.ts`).

## Images
- **Map:** `design/assets/demo-maps-ai/lisboa-tech-summit.webp`, 1104x1472 (3:4), WebP q80, 127 KB, no metadata.
  Qwen-Image via HF Space `mcp-tools/Qwen-Image` (Apache 2.0), seed 3301 (randomize off), 16 steps, guidance 4.
  Only candidate: the free ZeroGPU quota ran out before seed 4402 could run.
  Retouch: the word "WELCOME" on the registration kiosk awning was filled with the awning white (about 60x40 px).
  The whole image was multiplied by cream (255, 251, 234) so its white ground matches the cream paper of the Toledo map.
  Expo stand panels have tiny illegible marks, left as they are (same rule as `havnelobet`).
- **Cover:** `design/assets/event-covers/lisboa-tech-summit.webp`, 960x640, WebP q76, 56 KB, no metadata.
  Same Space, seed 1201, 3:2 (1584x1056 output), 16 steps, guidance 4, demo-cover negative prompt; downscaled with Lanczos.
  Multiplied by the same cream (255, 251, 234) as the map, so the white sky reads as warm paper.
  The fine black-and-white cobblestones did not fit in 60 KB (70 KB even at q64), so a light smoothing filter
  was applied before encoding at q76. No text or signature in the image.
