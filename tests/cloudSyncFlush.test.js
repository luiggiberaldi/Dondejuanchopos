import { describe, test, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { flushCloudProductsSync } from '../src/hooks/useSupervisorCommands';

vi.mock('../src/hooks/useCloudSync', () => ({
    pushCloudSync: vi.fn(async () => true)
}));

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async () => [{ id: 'p1', name: 'Test' }])
    }
}));

describe('Deferred Cloud Products Sync Flush tests', () => {
    test('flushCloudProductsSync is safe when no sync is pending', async () => {
        await expect(flushCloudProductsSync()).resolves.not.toThrow();
    });

    test('H1 invariant: visibilitychange listener is registered on document (not window)', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../src/hooks/useSupervisorCommands.js'), 'utf-8');
        expect(src).toMatch(/document\.addEventListener\(\s*['"]visibilitychange/);
        expect(src).not.toMatch(/window\.addEventListener\(\s*['"]visibilitychange/);
    });
});
