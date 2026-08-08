import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';

vi.mock('../src/config/supabaseCloud.js', () => ({
    supabaseCloud: {
        storage: {
            from: () => ({
                upload: vi.fn().mockResolvedValue({ error: null }),
                getPublicUrl: vi.fn().mockReturnValue({
                    data: { publicUrl: 'https://cdn.example.com/storage/v1/object/public/product-images/d/p.jpg' }
                }),
            }),
        },
    },
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        storage: {
            from: () => ({
                upload: vi.fn().mockResolvedValue({ error: null }),
                getPublicUrl: vi.fn().mockReturnValue({
                    data: { publicUrl: 'https://cdn.example.com/storage/v1/object/public/product-images/d/p.jpg' }
                }),
            }),
        },
    },
}));

const store = new Map();
vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, def) => store.get(key) ?? def),
        setItem: vi.fn(async (key, val) => { store.set(key, val); }),
    },
}));
vi.mock('../src/utils/withLock', () => ({
    withLock: vi.fn((_key, fn) => fn()),
}));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn() }));
vi.mock('../src/services/kardexService', () => ({
    recordKardexMovementUnlocked: vi.fn().mockResolvedValue(undefined),
}));

import { applyInventoryCommand } from '../src/utils/remoteInventoryProcessor';

const VALID_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const BASE_PRODUCT = {
    id: 'p1', name: 'Prod', priceUsd: 5, stock: 10,
    image: 'https://old.url/img.jpg', updatedAt: '2025-01-01T00:00:00.000Z',
};

describe('remoteInventoryProcessor — EGRESS RC2', () => {
    beforeEach(() => {
        store.clear();
        vi.clearAllMocks();
        localStorage.setItem('dj_device_id', 'caja-001');
    });

    it('RC2-01: add con base64 → imagen guardada como URL', async () => {
        store.set('bodega_products_v1', []);
        const result = await applyInventoryCommand({
            action: 'add', productId: 'new1',
            data: { id: 'new1', name: 'Nuevo', priceUsd: 3, stock: 0, image: VALID_B64 },
        });
        expect(result.success).toBe(true);
        const saved = store.get('bodega_products_v1').find(p => p.id === 'new1');
        expect(saved.image).not.toMatch(/^data:/);
        expect(saved.image).toContain('product-images');
    });

    it('RC2-02: edit con base64 → imagen guardada como URL', async () => {
        store.set('bodega_products_v1', [{ ...BASE_PRODUCT }]);
        const result = await applyInventoryCommand({
            action: 'edit', productId: 'p1',
            data: { name: 'Editado', priceUsd: 6, image: VALID_B64,
                    baseUpdatedAt: '2025-01-01T00:00:00.000Z' },
        });
        expect(result.success).toBe(true);
        const saved = store.get('bodega_products_v1').find(p => p.id === 'p1');
        expect(saved.image).not.toMatch(/^data:/);
    });

    it('RC2-03: upload falla → base64 conservado, comando igual exitoso', async () => {
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        const spy = vi.spyOn(await import('../src/utils/imageUpload'), 'uploadProductImage').mockResolvedValueOnce(null);
        store.set('bodega_products_v1', []);
        const result = await applyInventoryCommand({
            action: 'add', productId: 'p2',
            data: { id: 'p2', name: 'Fallback', priceUsd: 1, stock: 0, image: VALID_B64 },
        });
        expect(result.success).toBe(true);
        const saved = store.get('bodega_products_v1').find(p => p.id === 'p2');
        expect(saved.image).toMatch(/^data:/);
        spy.mockRestore();
    });

    it('RC2-04: comando sin imagen no llama uploadProductImage', async () => {
        store.set('bodega_products_v1', [{ ...BASE_PRODUCT }]);
        const imageUpload = await import('../src/utils/imageUpload');
        const spy = vi.spyOn(imageUpload, 'uploadProductImage');
        await applyInventoryCommand({
            action: 'edit', productId: 'p1',
            data: { name: 'Solo precio', priceUsd: 7, baseUpdatedAt: '2025-01-01T00:00:00.000Z' },
        });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('RC2-05: URL de Storage pasada directamente no se re-sube', async () => {
        store.set('bodega_products_v1', []);
        const imageUpload = await import('../src/utils/imageUpload');
        const spy = vi.spyOn(imageUpload, 'uploadProductImage');
        await applyInventoryCommand({
            action: 'add', productId: 'p3',
            data: { id: 'p3', name: 'URL directa', priceUsd: 2, stock: 0,
                    image: 'https://x.supabase.co/storage/v1/object/public/product-images/d/p.jpg' },
        });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('remoteInventoryProcessor — comentarios y dead code', () => {
    const src = readFileSync('src/utils/remoteInventoryProcessor.js', 'utf8');

    it('FA01: D8 no afirma "nunca viaja base64"', () => {
        expect(src).not.toMatch(/nunca viaja base64/);
    });

    it('FA04: destructuring externo de payload no declara `data`', () => {
        expect(src).not.toMatch(/const\s*\{\s*action\s*,\s*productId\s*,\s*data\s*\}\s*=\s*payload/);
    });
});

describe('remoteInventoryProcessor — rechazo de conflicto (FA05)', () => {
    beforeEach(() => {
        store.clear();
        vi.clearAllMocks();
    });

    it('FA05: rechazo incluye nombre del producto y flag conflictRejection', async () => {
        store.set('bodega_products_v1', [{
            id: 'pConflict', name: 'Café Molido', priceUsd: 3,
            stock: 10, updatedAt: '2025-06-01T12:00:00.000Z',
        }]);
        const result = await applyInventoryCommand({
            action: 'edit', productId: 'pConflict',
            data: { name: 'Café Molido', priceUsd: 4, baseUpdatedAt: '2025-01-01T00:00:00.000Z' },
        });
        expect(result.success).toBe(false);
        expect(result.conflictRejection).toBe(true);
        expect(result.productName).toBe('Café Molido');
        expect(result.error).toContain('Café Molido');
    });

    it('FA05: edición sin conflicto no incluye conflictRejection', async () => {
        store.set('bodega_products_v1', [{
            id: 'pOk', name: 'Arroz', priceUsd: 1,
            stock: 5, updatedAt: '2025-01-01T00:00:00.000Z',
        }]);
        const result = await applyInventoryCommand({
            action: 'edit', productId: 'pOk',
            data: { name: 'Arroz', priceUsd: 2, baseUpdatedAt: '2025-01-01T00:00:00.000Z' },
        });
        expect(result.success).toBe(true);
        expect(result.conflictRejection).toBeUndefined();
    });
});
