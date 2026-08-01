import { describe, test, expect, vi, beforeEach } from 'vitest';
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
});
