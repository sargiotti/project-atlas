import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every top-level static folder in apps/web/public must bypass the Worker (negative run_worker_first pattern),
// otherwise the Worker's 404 shell answers instead of the asset.
describe('wrangler run_worker_first exclusions', () => {
  it('excludes every top-level folder of apps/web/public', () => {
    const toml = readFileSync(resolve(import.meta.dirname, '../wrangler.toml'), 'utf8');
    const folders = readdirSync(resolve(import.meta.dirname, '../../web/public'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    const missing = folders.filter((f) => !toml.includes(`"!/${f}/*"`));
    expect(missing).toEqual([]);
  });
});
