import { expect, test, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createId } from '../src/utils/createId';
test('creates unique UUID v4 IDs on tailnet HTTP without crypto.randomUUID', () => {
 vi.stubGlobal('crypto', {getRandomValues: webcrypto.getRandomValues.bind(webcrypto)});
 try {
  const ids = new Set(Array.from({length:100},createId));
  expect(ids.size).toBe(100);
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 } finally { vi.unstubAllGlobals(); }
});
