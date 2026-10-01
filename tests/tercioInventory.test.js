import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ store: new Map() }));

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => (
            state.store.has(key) ? state.store.get(key) : defaultValue
        )),
        setItem: vi.fn(async (key, value) => {
            state.store.set(key, JSON.parse(JSON.stringify(value)));
            return value;
        }),
        removeItem: vi.fn(async key => state.store.delete(key))
    }
}));

vi.mock('../src/utils/withLock', () => ({
    withLock: vi.fn(async (_name, callback) => callback())
}));

vi.mock('../src/hooks/useCloudSync', () => ({
    queueCloudSync: vi.fn(),
    pushCloudSync: vi.fn(async () => true)
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn()
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: {
        getState: () => ({ usuarioActivo: { id: 'u1', nombre: 'Tester', rol: 'ADMIN' } })
    }
}));

import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { storageService } from '../src/utils/storageService';

const PRODUCTS_KEY = 'bodega_products_v1';
const SALES_KEY = 'bodega_sales_v1';
const KARDEX_KEY = 'bodega_kardex_v1';
const TERCIO_ID = 'tercio-polar-test';

const tercio = {
    id: TERCIO_ID,
    name: 'Tercio Polar',
    unit: 'unidad',
    stock: 327,
    priceUsd: 1,
    costUsd: 0.4
};

describe('E2E Tercio Polar: venta, inventario, Kardex y anulación', () => {
    beforeEach(async () => {
        state.store.clear();
        localStorage.clear();
        await storageService.setItem(PRODUCTS_KEY, [tercio]);
        await storageService.setItem(KARDEX_KEY, []);
        await storageService.setItem(SALES_KEY, []);
        await storageService.setItem('bodega_customers_v1', []);
    });

    it('descuenta una unidad y la devuelve una sola vez al anular la venta', async () => {
        const saleResult = await processSaleTransaction({
            cart: [{
                id: 'tercio-line-1',
                _originalId: TERCIO_ID,
                name: 'Tercio Polar',
                priceUsd: 1,
                qty: 1
            }],
            cartTotalUsd: 1,
            cartTotalBs: 40,
            cartSubtotalUsd: 1,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 1, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: [tercio],
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40,
            checkoutOperationId: 'tercio-sale-1'
        });

        expect(saleResult.success).toBe(true);
        expect(saleResult.updatedProducts).toEqual([
            expect.objectContaining({ id: TERCIO_ID, stock: 326 })
        ]);
        expect(state.store.get(KARDEX_KEY)).toEqual([
            expect.objectContaining({
                producto_id: TERCIO_ID,
                tipo: 'VENTA',
                cantidad: -1,
                stock_antes: 327,
                stock_despues: 326
            })
        ]);

        const voidResult = await processVoidSale(
            saleResult.sale,
            [saleResult.sale],
            saleResult.updatedProducts
        );

        expect(voidResult.updatedProducts).toEqual([
            expect.objectContaining({ id: TERCIO_ID, stock: 327 })
        ]);
        expect(state.store.get(KARDEX_KEY)).toEqual(expect.arrayContaining([
            expect.objectContaining({ tipo: 'VENTA', cantidad: -1 }),
            expect.objectContaining({
                producto_id: TERCIO_ID,
                tipo: 'DEVOLUCION',
                cantidad: 1,
                stock_antes: 326,
                stock_despues: 327
            })
        ]));
        expect(state.store.get(SALES_KEY)[0].status).toBe('ANULADA');
    });
});
