import { describe, test, expect, beforeEach, vi } from 'vitest';
import localforage from 'localforage';
import { applyInventoryCommand } from '../src/utils/remoteInventoryProcessor';
import { PRICING_MODES } from '../src/constants/pricingModes';

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

describe('remoteInventoryProcessor D4 cleanup tests', () => {
    beforeEach(() => {
        localforage._reset();
        vi.clearAllMocks();
    });

    test('edit action with pricingMode=bcv clears priceBsManual, boxPriceBsManual, halfBoxPriceBsManual', async () => {
        const existingProduct = {
            id: 'p1',
            name: 'Harina',
            pricingMode: 'bs_fijo',
            priceBsManual: 50,
            boxPricingMode: 'bs_fijo',
            boxPriceBsManual: 500,
            halfBoxPricingMode: 'bs_fijo',
            halfBoxPriceBsManual: 250,
            priceUsd: 1,
            stock: 10
        };
        await localforage.setItem('bodega_products_v1', [existingProduct]);

        const result = await applyInventoryCommand({
            action: 'edit',
            productId: 'p1',
            data: {
                name: 'Harina',
                pricingMode: 'bcv',
                boxPricingMode: 'bcv',
                halfBoxPricingMode: 'bcv',
                priceUsd: 1
            }
        });

        expect(result.success).toBe(true);
        const updatedCatalog = await localforage.getItem('bodega_products_v1');
        const updated = updatedCatalog.find(p => p.id === 'p1');

        expect(updated.pricingMode).toBe('bcv');
        expect(updated.priceBsManual).toBeNull();
        expect(updated.boxPriceBsManual).toBeNull();
        expect(updated.halfBoxPriceBsManual).toBeNull();
    });

    test('batch_edit action with pricingMode=bs_fijo preserves priceBsManual and box prices', async () => {
        const existingProduct = {
            id: 'p1',
            name: 'Harina',
            pricingMode: 'bcv',
            priceUsd: 1,
            stock: 10
        };
        await localforage.setItem('bodega_products_v1', [existingProduct]);

        const result = await applyInventoryCommand({
            action: 'batch_edit',
            data: {
                items: [{
                    productId: 'p1',
                    data: {
                        name: 'Harina',
                        priceUsd: 1,
                        priceBsManual: 75,
                        pricingMode: 'bs_fijo',
                        boxPriceBsManual: 750,
                        boxPricingMode: 'bs_fijo'
                    }
                }]
            }
        });

        expect(result.success).toBe(true);
        const updatedCatalog = await localforage.getItem('bodega_products_v1');
        const updated = updatedCatalog.find(p => p.id === 'p1');

        expect(updated.pricingMode).toBe('bs_fijo');
        expect(updated.priceBsManual).toBe(75);
        expect(updated.boxPriceBsManual).toBe(750);
    });

    test('PRICING_MODES includes canonical modes', () => {
        expect([...PRICING_MODES]).toEqual(['tasa_dia', 'bcv', 'dual_usd', 'bs_fijo']);
    });
});
