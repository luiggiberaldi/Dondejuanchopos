import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ rows: [], write: vi.fn(), push: vi.fn() }));
vi.mock('../src/utils/storageService', () => ({ storageService: {
    getItem: async () => structuredClone(m.rows),
    setItem: (...args) => m.write(...args),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: m.push }));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn() }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: {
    getState: () => ({ usuarioActivo: { id: 'test-admin', nombre: 'Admin', rol: 'ADMIN' } }),
} }));
import { createInventorySnapshot } from '../src/services/kardexService';

beforeEach(() => {
    localStorage.clear(); localStorage.setItem('dj_device_id', 'box-fixture');
    m.rows = []; m.write.mockReset().mockResolvedValue(undefined); m.push.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('H12: snapshot Kardex invocado explícitamente', () => {
    it('usa un mismo timestamp para corte, creación y actualización y guarda una sola vez', async () => {
        const products = [{ id: 'p', name: 'Producto', stock: 2, costUsd: 3 }];
        const before = structuredClone(products);
        const result = await createInventorySnapshot('close-fixture', products, { id: 'u', nombre: 'Prueba', rol: 'ADMIN' });
        expect(result).toMatchObject({ cierre_id: 'close-fixture', device_id: 'box-fixture', total_items: 2, total_valorizado_usd: 6 });
        expect(Number.isFinite(Date.parse(result.createdAt))).toBe(true);
        expect(result.fecha_corte).toBe(result.createdAt);
        expect(result.created_at).toBe(result.createdAt);
        expect(result.updatedAt).toBe(result.createdAt);
        expect(m.write).toHaveBeenCalledExactlyOnceWith('bodega_kardex_snapshots_v1', [result]);
        expect(m.push).toHaveBeenCalledExactlyOnceWith('bodega_kardex_snapshots_v1', [result]);
        expect(products).toEqual(before);
    });
    it('permite snapshot de inventario vacío sin inventar ítems', async () => {
        const result = await createInventorySnapshot('empty-close', []);
        expect(result).toMatchObject({ total_items: 0, total_valorizado_usd: 0, resumen_productos: [], usuario_id: 'test-admin' });
    });
    it('no intenta guardar entradas sin cierre o sin array de productos', async () => {
        await expect(createInventorySnapshot('', [])).resolves.toBeUndefined();
        await expect(createInventorySnapshot('c', null)).resolves.toBeUndefined();
        expect(m.write).not.toHaveBeenCalled();
        expect(m.push).not.toHaveBeenCalled();
    });
    it('preserva los snapshots anteriores', async () => {
        m.rows = [{ id: 'previous', cierre_id: 'older-close' }];
        const snapshot = await createInventorySnapshot('new-close', []);
        expect(m.write).toHaveBeenCalledExactlyOnceWith('bodega_kardex_snapshots_v1', [snapshot, ...m.rows]);
    });
    it('no anuncia sincronización ni repite escritura cuando falla la persistencia', async () => {
        const error = new Error('persistencia no confirmada');
        m.write.mockRejectedValue(error);
        await expect(createInventorySnapshot('failed-close', [])).rejects.toBe(error);
        expect(m.write).toHaveBeenCalledTimes(1);
        expect(m.push).not.toHaveBeenCalled();
    });
});
