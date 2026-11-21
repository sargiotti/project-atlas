import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATION } from '../src/http/health-routes';

// If this fails you added a migration: bump EXPECTED_MIGRATION in src/http/health-routes.ts, or the health
// check (and the uptime alert) will report an outage after deploy.
describe('health check expected migration', () => {
  it('equals the last file in apps/api/migrations', () => {
    const files = readdirSync(resolve(import.meta.dirname, '../migrations')).filter((f) => f.endsWith('.sql')).sort();
    expect(EXPECTED_MIGRATION).toBe(files[files.length - 1]);
  });
});
