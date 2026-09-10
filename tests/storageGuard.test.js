import { describe, test, expect, beforeEach, vi } from 'vitest';
import localforage from 'localforage';
import { storageService } from '../src/utils/storageService';

vi.mock('localforage', () => {
    let store = {};
    return {
        default: {
            config: vi.fn(),
            getItem: vi.fn(async (key) => store[key] || null),
            setItem: vi.fn(async (key, val) => { store[key] = val; return val; }),
            removeItem: vi.fn(async (key) => { delete store[key]; }),
            _reset: () => { store = {}; }
        }
    };
});

describe('Circuit Breaker & Shadow Snapshot unit tests', () => {
    beforeEach(() => {
        localStorage.clear();
        localforage._reset();
        vi.clearAllMocks();
    });

    test('Circuit Breaker throws when reducing 500 products to 50 without flag', async () => {
        const existing = Array.from({ length: 500 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));
        await localforage.setItem('bodega_products_v1', existing);

        const reduced = Array.from({ length: 50 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));

        await expect(storageService.setItem('bodega_products_v1', reduced))
            .rejects.toThrow(/\[CircuitBreaker\]/);
    });

    test('Circuit Breaker allows reducing 500 products to 400', async () => {
        const existing = Array.from({ length: 500 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));
        await localforage.setItem('bodega_products_v1', existing);

        const reduced = Array.from({ length: 400 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));

        await expect(storageService.setItem('bodega_products_v1', reduced)).resolves.not.toThrow();
    });

    test('Circuit Breaker allows reducing 500 products to 50 when valid flag and timestamp are set', async () => {
        const existing = Array.from({ length: 500 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));
        await localforage.setItem('bodega_products_v1', existing);

        localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true');
        localStorage.setItem('confirm_bulk_delete_catalog_ts', Date.now().toString());

        const reduced = Array.from({ length: 50 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));

        await expect(storageService.setItem('bodega_products_v1', reduced)).resolves.not.toThrow();
    });

    test('Circuit Breaker respects floor of 5 for small catalogs (10 to 3)', async () => {
        const existing = Array.from({ length: 10 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));
        await localforage.setItem('bodega_products_v1', existing);

        const reduced = Array.from({ length: 3 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));

        await expect(storageService.setItem('bodega_products_v1', reduced))
            .rejects.toThrow(/\[CircuitBreaker\]/);
    });

    test('Shadow Snapshot is NOT updated when catalog shrinks', async () => {
        const existing = Array.from({ length: 100 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));
        await localforage.setItem('bodega_products_v1', existing);
        await localforage.setItem('bodega_products_shadow_backup_v1', existing);

        // Precolocar un timestamp viejo
        localStorage.setItem('bodega_shadow_backup_ts', (Date.now() - 3600000).toString());

        const reduced = Array.from({ length: 90 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));

        await storageService.setItem('bodega_products_v1', reduced);

        // La copia de sombra no debe haberse actualizado con los 100 existentes en esta escritura que encogió
        const shadow = await localforage.getItem('bodega_products_shadow_backup_v1');
        expect(shadow).toHaveLength(100);
    });

    test('Shadow Snapshot is throttled to 30 min interval for growing writes', async () => {
        const existing = Array.from({ length: 10 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));
        await localforage.setItem('bodega_products_v1', existing);

        // Primera escritura creciente
        const growing1 = Array.from({ length: 12 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));
        await storageService.setItem('bodega_products_v1', growing1);

        const shadow1 = await localforage.getItem('bodega_products_shadow_backup_v1');
        expect(shadow1).toHaveLength(10); // Respalda los 10 originales

        // Segunda escritura creciente inmediata (5 segundos después)
        const growing2 = Array.from({ length: 15 }, (_, i) => ({ id: `p_${i}`, name: `Prod ${i}` }));
        await storageService.setItem('bodega_products_v1', growing2);

        const shadow2 = await localforage.getItem('bodega_products_shadow_backup_v1');
        expect(shadow2).toHaveLength(10); // Mantiene el respaldo de los 10 originales sin sobrescribir
    });

    test('Sales Circuit Breaker prevents dropping sales by auto-merging', async () => {
        const existingSales = [
            { id: 'sale-1', totalUsd: 10, timestamp: '2026-09-05T01:00:00Z' },
            { id: 'sale-2', totalUsd: 20, timestamp: '2026-09-05T01:10:00Z' },
            { id: 'sale-3', totalUsd: 30, timestamp: '2026-09-05T01:20:00Z' },
        ];
        await localforage.setItem('bodega_sales_v1', existingSales);

        // Attempt to save a truncated sales array (missing sale-2 and sale-3)
        const truncatedSales = [
            { id: 'sale-1', totalUsd: 10, timestamp: '2026-09-05T01:00:00Z' }
        ];

        await storageService.setItem('bodega_sales_v1', truncatedSales);

        // Check that sales were NOT dropped: they were auto-merged!
        const saved = await localforage.getItem('bodega_sales_v1');
        expect(saved).toHaveLength(3);
        const ids = saved.map(s => s.id);
        expect(ids).toContain('sale-1');
        expect(ids).toContain('sale-2');
        expect(ids).toContain('sale-3');
    });

    test('Sales Circuit Breaker creates shadow backup when sales grow', async () => {
        const existingSales = [
            { id: 'sale-1', totalUsd: 10, timestamp: '2026-09-05T01:00:00Z' }
        ];
        await localforage.setItem('bodega_sales_v1', existingSales);

        const moreSales = [
            { id: 'sale-2', totalUsd: 20, timestamp: '2026-09-05T01:10:00Z' },
            { id: 'sale-1', totalUsd: 10, timestamp: '2026-09-05T01:00:00Z' }
        ];

        await storageService.setItem('bodega_sales_v1', moreSales);

        const shadow = await localforage.getItem('bodega_sales_shadow_backup_v1');
        expect(shadow).toHaveLength(1);
        expect(shadow[0].id).toBe('sale-1');
    });

    test('Customer Circuit Breaker throws when reducing 20 customers to 5 without flag', async () => {
        const existingCustomers = Array.from({ length: 20 }, (_, i) => ({ id: `c_${i}`, name: `Cliente ${i}` }));
        await localforage.setItem('bodega_customers_v1', existingCustomers);

        const truncatedCustomers = Array.from({ length: 5 }, (_, i) => ({ id: `c_${i}`, name: `Cliente ${i}` }));

        await expect(storageService.setItem('bodega_customers_v1', truncatedCustomers))
            .rejects.toThrow(/\[CircuitBreaker\]/);
    });

    test('Customer Circuit Breaker allows reducing 20 customers to 18', async () => {
        const existingCustomers = Array.from({ length: 20 }, (_, i) => ({ id: `c_${i}`, name: `Cliente ${i}` }));
        await localforage.setItem('bodega_customers_v1', existingCustomers);

        const reducedCustomers = Array.from({ length: 18 }, (_, i) => ({ id: `c_${i}`, name: `Cliente ${i}` }));

        await expect(storageService.setItem('bodega_customers_v1', reducedCustomers))
            .resolves.not.toThrow();
    });

    test('Customer Circuit Breaker creates shadow backup on write', async () => {
        const existingCustomers = [
            { id: 'c_1', name: 'Cliente 1' },
            { id: 'c_2', name: 'Cliente 2' },
            { id: 'c_3', name: 'Cliente 3' },
            { id: 'c_4', name: 'Cliente 4' },
            { id: 'c_5', name: 'Cliente 5' }
        ];
        await localforage.setItem('bodega_customers_v1', existingCustomers);

        const updatedCustomers = [
            ...existingCustomers,
            { id: 'c_6', name: 'Cliente 6' }
        ];

        await storageService.setItem('bodega_customers_v1', updatedCustomers);

        const shadow = await localforage.getItem('bodega_customers_shadow_backup_v1');
        expect(shadow).toHaveLength(5);
        expect(shadow[0].id).toBe('c_1');
    });
});

