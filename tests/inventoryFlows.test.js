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
import {
    getAllSessions,
    registerPartialDispatch,
    revertDispatchRound
} from '../src/services/consumptionSessionService';
import { storageService } from '../src/utils/storageService';

const PRODUCTS_KEY = 'bodega_products_v1';
const SALES_KEY = 'bodega_sales_v1';
const KARDEX_KEY = 'bodega_kardex_v1';

const products = [
    { id: 'polar', name: 'Polar Pilsen', stock: 20, priceUsd: 1, costUsd: 0.4 },
    { id: 'ice', name: 'Polar Ice', stock: 15, priceUsd: 1, costUsd: 0.4 },
    { id: 'tobo', name: 'Tobo Hielo', stock: 5, priceUsd: 2, costUsd: 0.8 },
    {
        id: 'combo',
        name: 'Tobo Fiesta',
        isCombo: true,
        isModular: true,
        priceUsd: 12,
        costUsd: 4,
        comboItems: [{ productId: 'tobo', qty: 1 }],
        modularGroups: [{ requiredQty: 10, allowedProductIds: ['polar', 'ice'] }]
    }
];

describe('E2E inventario físico + Kardex', () => {
    beforeEach(async () => {
        state.store.clear();
        localStorage.clear();
        await storageService.setItem(PRODUCTS_KEY, products);
        await storageService.setItem(KARDEX_KEY, []);
        await storageService.setItem(SALES_KEY, []);
        await storageService.setItem('bodega_customers_v1', []);
    });

    it('registra componentes reales en checkout y los revierte sin registrar el padre combo', async () => {
        const cartItem = {
            id: 'combo-line-1',
            _originalId: 'combo',
            name: 'Tobo Fiesta',
            priceUsd: 12,
            qty: 1,
            isModular: true,
            modularSelections: [
                { groupId: 'beers', productId: 'polar', qty: 6, productName: 'Polar Pilsen' },
                { groupId: 'beers', productId: 'ice', qty: 4, productName: 'Polar Ice' }
            ]
        };

        const saleResult = await processSaleTransaction({
            cart: [cartItem],
            cartTotalUsd: 12,
            cartTotalBs: 480,
            cartSubtotalUsd: 12,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 12, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(saleResult.success).toBe(true);
        expect(saleResult.updatedProducts.find(p => p.id === 'polar').stock).toBe(14);
        expect(saleResult.updatedProducts.find(p => p.id === 'ice').stock).toBe(11);
        expect(saleResult.updatedProducts.find(p => p.id === 'tobo').stock).toBe(4);

        const saleMoves = state.store.get(KARDEX_KEY);
        expect(saleMoves).toHaveLength(3);
        expect(saleMoves.map(move => move.producto_id)).toEqual(expect.arrayContaining(['polar', 'ice', 'tobo']));
        expect(saleMoves.some(move => move.producto_id === 'combo')).toBe(false);
        expect(saleMoves.every(move => move.tipo === 'VENTA')).toBe(true);
        expect(saleMoves.find(move => move.producto_id === 'polar')).toMatchObject({
            cantidad: -6,
            stock_antes: 20,
            stock_despues: 14
        });
        expect(saleResult.sale.inventoryDeductions).toEqual(expect.arrayContaining([
            expect.objectContaining({ productoId: 'polar', cantidad: -6 }),
            expect.objectContaining({ productoId: 'ice', cantidad: -4 }),
            expect.objectContaining({ productoId: 'tobo', cantidad: -1 })
        ]));

        // Cambiar la definición del combo después de venderlo no debe cambiar
        // la composición que la anulación devuelve al inventario.
        await storageService.setItem(PRODUCTS_KEY, saleResult.updatedProducts.map(product => (
            product.id === 'combo'
                ? { ...product, comboItems: [{ productId: 'ice', qty: 99 }] }
                : product
        )));

        const voidResult = await processVoidSale(saleResult.sale, [saleResult.sale], saleResult.updatedProducts);
        expect(voidResult.updatedProducts.find(p => p.id === 'polar').stock).toBe(20);
        expect(voidResult.updatedProducts.find(p => p.id === 'ice').stock).toBe(15);
        expect(voidResult.updatedProducts.find(p => p.id === 'tobo').stock).toBe(5);

        const allMoves = state.store.get(KARDEX_KEY);
        expect(allMoves).toHaveLength(6);
        expect(allMoves.filter(move => move.tipo === 'DEVOLUCION')).toHaveLength(3);
        expect(allMoves.some(move => move.producto_id === 'combo')).toBe(false);
        expect(allMoves.find(move => move.tipo === 'DEVOLUCION' && move.producto_id === 'polar')).toMatchObject({
            cantidad: 6,
            stock_antes: 14,
            stock_despues: 20
        });
        expect(state.store.get(SALES_KEY)[0].status).toBe('ANULADA');
    });

    it('Venta Libre no descuenta productos ni crea movimientos Kardex', async () => {
        const result = await processSaleTransaction({
            cart: [{
                id: 'custom_venta_libre_1',
                name: 'Venta Libre',
                priceUsd: 5,
                qty: 1,
                costUsd: 0,
                costBs: 0
            }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 5, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(result.success).toBe(true);
        expect(result.sale.inventoryDeductions).toEqual([]);
        expect(state.store.get(KARDEX_KEY)).toEqual([]);
        expect(result.updatedProducts).toEqual(products);
    });

    it('abona el vuelto a cuenta y lo revierte correctamente aunque reduzca deuda', async () => {
        const customer = { id: 'wallet-customer', name: 'Cliente Wallet', deuda: 10, favor: 0 };
        await storageService.setItem('bodega_customers_v1', [customer]);

        const result = await processSaleTransaction({
            cart: [{ id: 'polar-wallet-line', _originalId: 'polar', name: 'Polar Pilsen', priceUsd: 5, qty: 1 }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 10, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                vueltoParaMonederoUsd: 5,
                vueltoCredito: true,
            },
            selectedCustomerId: customer.id,
            customers: [customer],
            products,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40,
        });

        expect(result.success).toBe(true);
        expect(result.sale).toMatchObject({
            vueltoParaMonedero: 5,
            vueltoCredito: true,
            vueltoParaMonederoDebtUsd: 5,
            vueltoParaMonederoFavorUsd: 0,
        });
        expect(result.updatedCustomers.find(c => c.id === customer.id)).toMatchObject({ deuda: 5, favor: 0 });

        const voided = await processVoidSale(result.sale, [result.sale], result.updatedProducts);
        expect(voided.updatedCustomers.find(c => c.id === customer.id)).toMatchObject({ deuda: 10, favor: 0 });
    });

    it('rechaza abonar el vuelto cuando el cliente seleccionado no existe', async () => {
        const result = await processSaleTransaction({
            cart: [{ id: 'polar-wallet-invalid', _originalId: 'polar', name: 'Polar Pilsen', priceUsd: 5, qty: 1 }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 10, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0, vueltoParaMonederoUsd: 5, vueltoCredito: true },
            selectedCustomerId: 'missing-customer',
            customers: [],
            products,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40,
        });

        expect(result).toEqual({ success: false, error: 'El cliente seleccionado ya no está disponible.' });
        expect(state.store.get(SALES_KEY)).toEqual([]);
    });

    it('anulación con clamp devuelve solo las unidades realmente descontadas', async () => {
        localStorage.removeItem('allow_negative_stock');
        const lowStockProducts = products.map(product => (
            product.id === 'polar' ? { ...product, stock: 2 } : product
        ));
        const cart = [{
            id: 'polar-line-clamped',
            _originalId: 'polar',
            name: 'Polar Pilsen',
            priceUsd: 5,
            qty: 5
        }];
        await storageService.setItem(PRODUCTS_KEY, lowStockProducts);
        const saleResult = await processSaleTransaction({
            cart,
            cartTotalUsd: 25,
            cartTotalBs: 1000,
            cartSubtotalUsd: 25,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 25, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: lowStockProducts,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(saleResult.success).toBe(true);
        expect(saleResult.updatedProducts.find(product => product.id === 'polar').stock).toBe(0);
        expect(saleResult.sale.inventoryDeductionsApplied).toEqual([
            expect.objectContaining({ productoId: 'polar', cantidad: -2, cantidadSolicitada: -5 })
        ]);

        const voidResult = await processVoidSale(saleResult.sale, [saleResult.sale], saleResult.updatedProducts);
        expect(voidResult.updatedProducts.find(product => product.id === 'polar').stock).toBe(2);
        expect(state.store.get(KARDEX_KEY).filter(move => move.producto_id === 'polar')).toEqual([
            expect.objectContaining({ tipo: 'DEVOLUCION', cantidad: 2 }),
            expect.objectContaining({ tipo: 'VENTA', cantidad: -2 })
        ]);
    });

    it('reintento de checkout devuelve stock persistido y no el estado capturado', async () => {
        const cart = [{
            id: 'tobo-line-1',
            _originalId: 'tobo',
            name: 'Tobo Hielo',
            priceUsd: 2,
            qty: 1
        }];
        const checkout = {
            cart,
            cartTotalUsd: 2,
            cartTotalBs: 80,
            cartSubtotalUsd: 2,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 2, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40,
            checkoutOperationId: 'checkout-retry-1'
        };

        const first = await processSaleTransaction(checkout);
        expect(first.success).toBe(true);
        expect(first.updatedProducts.find(p => p.id === 'tobo').stock).toBe(4);

        const retry = await processSaleTransaction(checkout);
        expect(retry.success).toBe(true);
        expect(retry.duplicate).toBe(true);
        expect(retry.updatedProducts.find(p => p.id === 'tobo').stock).toBe(4);
        expect(state.store.get(KARDEX_KEY)).toHaveLength(1);
    });

    it('mantiene consumo diferido separado del cobro, con despacho/reversión idempotentes', async () => {
        const deferredItem = {
            id: 'deferred-line-1',
            _originalId: 'combo',
            name: 'Tobo Fiesta',
            priceUsd: 12,
            qty: 1,
            isModular: true,
            isDeferredConsumption: true,
            deferredCustomerRef: 'Mesa 4',
            totalUnits: 10,
            modularGroups: [{ requiredQty: 10 }],
            modularSelections: [{ productId: 'polar', qty: 2, productName: 'Polar Pilsen' }]
        };

        const saleResult = await processSaleTransaction({
            cart: [deferredItem],
            cartTotalUsd: 12,
            cartTotalBs: 480,
            cartSubtotalUsd: 12,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 12, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(saleResult.success).toBe(true);
        expect(saleResult.updatedProducts.find(p => p.id === 'polar').stock).toBe(18);
        const [session] = await getAllSessions();
        expect(session).toMatchObject({ status: 'OPEN', servedCount: 2, totalQuota: 10 });

        const dispatch = await registerPartialDispatch(
            session.id,
            [{ productId: 'ice', qty: 3 }],
            'Tester',
            'dispatch-request-1'
        );
        expect(dispatch.success).toBe(true);
        expect(dispatch.session.servedCount).toBe(5);
        expect(state.store.get(PRODUCTS_KEY).find(p => p.id === 'ice').stock).toBe(12);

        const replay = await registerPartialDispatch(
            session.id,
            [{ productId: 'ice', qty: 3 }],
            'Tester',
            'dispatch-request-1'
        );
        expect(replay.success).toBe(true);
        expect(replay.idempotent).toBe(true);
        expect(state.store.get(PRODUCTS_KEY).find(p => p.id === 'ice').stock).toBe(12);

        const dispatchId = dispatch.session.dispatches.find(item => item.id === 'dispatch-request-1').id;
        const reverted = await revertDispatchRound(session.id, dispatchId, 'Tester');
        expect(reverted.success).toBe(true);
        expect(state.store.get(PRODUCTS_KEY).find(p => p.id === 'ice').stock).toBe(15);
        expect(reverted.session.servedCount).toBe(2);

        const voidResult = await processVoidSale(saleResult.sale, [saleResult.sale], saleResult.updatedProducts);
        expect(voidResult.updatedProducts.find(p => p.id === 'polar').stock).toBe(20);
        expect(voidResult.updatedProducts.find(p => p.id === 'ice').stock).toBe(15);
        expect((await getAllSessions())[0].status).toBe('CANCELLED');
        expect(state.store.get(KARDEX_KEY)).toHaveLength(4);
    });

    it('permite venta de combo modular con componente en stock 0 cuando allow_negative_stock=true y lo revierte a 0', async () => {
        localStorage.setItem('allow_negative_stock', 'true');
        const zeroStockProducts = products.map(product => (
            product.id === 'ice' ? { ...product, stock: 0 } : product
        ));
        await storageService.setItem(PRODUCTS_KEY, zeroStockProducts);

        const cartItem = {
            id: 'combo-modular-neg-1',
            _originalId: 'combo',
            name: 'Tobo Fiesta',
            priceUsd: 12,
            qty: 1,
            isModular: true,
            modularSelections: [
                { groupId: 'beers', productId: 'polar', qty: 6, productName: 'Polar Pilsen' },
                { groupId: 'beers', productId: 'ice', qty: 4, productName: 'Polar Ice' }
            ]
        };

        const saleResult = await processSaleTransaction({
            cart: [cartItem],
            cartTotalUsd: 12,
            cartTotalBs: 480,
            cartSubtotalUsd: 12,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 12, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: zeroStockProducts,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(saleResult.success).toBe(true);
        // polar tenía 20, bajó a 14
        expect(saleResult.updatedProducts.find(p => p.id === 'polar').stock).toBe(14);
        // ice tenía 0, bajó a -4
        expect(saleResult.updatedProducts.find(p => p.id === 'ice').stock).toBe(-4);
        // tobo (componente fijo del combo) tenía 5, bajó a 4
        expect(saleResult.updatedProducts.find(p => p.id === 'tobo').stock).toBe(4);

        // Movimientos de Kardex para ice
        const iceMovements = state.store.get(KARDEX_KEY).filter(m => m.producto_id === 'ice');
        expect(iceMovements).toHaveLength(1);
        expect(iceMovements[0]).toEqual(expect.objectContaining({
            tipo: 'VENTA',
            cantidad: -4,
            stock_antes: 0,
            stock_despues: -4
        }));

        // Anulación revierte ice a 0 exactamente
        const voidResult = await processVoidSale(saleResult.sale, [saleResult.sale], saleResult.updatedProducts);
        expect(voidResult.updatedProducts.find(p => p.id === 'ice').stock).toBe(0);
        expect(voidResult.updatedProducts.find(p => p.id === 'polar').stock).toBe(20);
        expect(voidResult.updatedProducts.find(p => p.id === 'tobo').stock).toBe(5);
    });
});
