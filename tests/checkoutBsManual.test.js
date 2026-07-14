// tests/checkoutBsManual.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mocks de dependencias
const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'test-user', nombre: 'Tester', rol: 'ADMIN' } }) },
}));

import { FinancialEngine } from '../src/core/FinancialEngine';
import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { storageService } from '../src/utils/storageService';
import { divR, mulR } from '../src/utils/dinero';

describe('Checkout y Finanzas con Precios Bs Manuales (Ventas Pure Bs)', () => {

    beforeEach(() => {
        _memoryStore.clear();
    });

    it('buildCartTotals usa priceBsManual independiente del USD (precios duales)', () => {
        const cartItems = [
            { priceUsd: 2, priceBsManual: 90, qty: 2 },  // USD 4 | Bs 180
            { priceUsd: 1, priceBsManual: 45, qty: 1 },  // USD 1 | Bs 45
        ];
        const rate = 45;

        const totals = FinancialEngine.buildCartTotals(cartItems, null, rate, 0);

        // USD: suma directa e independiente = 2*2 + 1*1 = 5
        expect(totals.subtotalUsd).toBe(5);
        expect(totals.totalUsd).toBe(5);

        // Bs: suma de priceBsManual = 180 + 45 = 225 (NO 5*45; es independiente)
        expect(totals.subtotalBs).toBe(225);
        expect(totals.totalBs).toBe(225);
    });

    it('buildCartTotals cae a conversión por tasa cuando no hay priceBsManual', () => {
        const cartItems = [
            { priceUsd: 2, qty: 2 },
            { priceUsd: 1, qty: 1 },
        ];
        const rate = 45;

        const totals = FinancialEngine.buildCartTotals(cartItems, null, rate, 0);

        expect(totals.subtotalUsd).toBe(5);
        // Sin manual: Bs por tasa = 5 * 45 = 225
        expect(totals.subtotalBs).toBe(225);
    });

    it('checkoutProcessor procesa exitosamente una venta 100% en Bs con totales consistentes manuales (inversos)', async () => {
        // Inicializamos bodega_sales_v1 vacía
        await storageService.setItem('bodega_sales_v1', []);
        await storageService.setItem('bodega_products_v1', [{ id: 'p1', name: 'Licor', stock: 10 }]);

        const cart = [
            { id: 'p1', name: 'Licor', qty: 1, priceUsd: 10, priceBsManual: 460, _originalId: 'p1' }
        ];

        // Tasa BCV = 45.0
        // Total Bs manual = 460.0
        // Total USD inverso = 460 / 45 = 10.2222... -> 10.22
        // Total Bs consistenciado = 10.22 * 45 = 459.9 (o similar)
        // Para que pase la validación rígida del drift guard (FIN-022), los cartTotals de la venta deben coincidir.
        const rate = 45;
        const totalBsManual = 460;
        const totalUsdInverso = Number(divR(totalBsManual, rate)); // 10.22 USD

        const opts = {
            cart,
            cartTotalUsd: totalUsdInverso,
            cartTotalBs: mulR(totalUsdInverso, rate), // 459.9
            cartSubtotalUsd: totalUsdInverso,
            payments: [
                // Pago PM de 459.9 Bs (equivalente a 10.22 USD a tasa 45.0)
                { amountUsd: totalUsdInverso, amountBs: mulR(totalUsdInverso, rate), currency: 'VES', methodId: 'pago_movil', methodLabel: 'Pago Móvil' }
            ],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: [{ id: 'p1', name: 'Licor', stock: 10 }],
            effectiveRate: rate,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        };

        const result = await processSaleTransaction(opts);
        expect(result.success).toBe(true);
        expect(result.sale.totalUsd).toBe(totalUsdInverso);
        expect(result.sale.totalBs).toBe(mulR(totalUsdInverso, rate));
    });

    it('voidSaleProcessor retorna correctamente el inventario por caja/media caja al anular la venta', async () => {
        // Setup inicial
        const product = { 
            id: 'p2', 
            name: 'Vodka', 
            stock: 10,
            sellByBox: true,
            boxUnits: 12,
            sellByHalfBox: true,
            halfBoxUnits: 6
        };
        await storageService.setItem('bodega_products_v1', [product]);
        await storageService.setItem('bodega_sales_v1', []);

        // Caso 1: Venta de 1 bulto por Caja (debe retornar 12 unidades físicas)
        const saleBox = {
            id: 's_box',
            tipo: 'VENTA',
            status: 'COMPLETADA',
            saleNumber: 101,
            totalUsd: 100,
            totalBs: 4500,
            rate: 45,
            items: [
                { id: 'p2_box', name: 'Vodka [Caja]', qty: 1, priceUsd: 100, _mode: 'box', boxUnits: 12, _originalId: 'p2' }
            ],
            timestamp: new Date().toISOString()
        };

        await storageService.setItem('bodega_sales_v1', [saleBox]);
        await processVoidSale(saleBox, [saleBox], [product]);

        const [prodAfterBox] = await storageService.getItem('bodega_products_v1');
        // stock inicial = 10, + 12 de la caja = 22 unidades
        expect(prodAfterBox.stock).toBe(22);

        // Caso 2: Venta de 1 bulto por Media Caja (debe retornar 6 unidades físicas)
        const productReset = { ...product, stock: 10 };
        await storageService.setItem('bodega_products_v1', [productReset]);
        
        const saleHalfBox = {
            id: 's_half',
            tipo: 'VENTA',
            status: 'COMPLETADA',
            saleNumber: 102,
            totalUsd: 50,
            totalBs: 2250,
            rate: 45,
            items: [
                { id: 'p2_halfBox', name: 'Vodka [Media Caja]', qty: 1, priceUsd: 50, _mode: 'halfBox', halfBoxUnits: 6, _originalId: 'p2' }
            ],
            timestamp: new Date().toISOString()
        };

        await storageService.setItem('bodega_sales_v1', [saleHalfBox]);
        await processVoidSale(saleHalfBox, [saleHalfBox], [productReset]);

        const [prodAfterHalf] = await storageService.getItem('bodega_products_v1');
        // stock inicial = 10, + 6 de la media caja = 16 unidades
        expect(prodAfterHalf.stock).toBe(16);
    });
});
