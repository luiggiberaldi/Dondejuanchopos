import { describe, expect, it, beforeEach, vi } from 'vitest';

const memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => memoryStore.has(key) ? memoryStore.get(key) : defaultValue),
        setItem: vi.fn(async (key, value) => {
            memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
        removeItem: vi.fn(async (key) => memoryStore.delete(key)),
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
import {
    calculatePricing,
    normalizeProduct,
} from '../src/utils/productProcessor';
import {
    getFormatPriceAliasConflicts,
    migrateFormatPriceAliases,
} from '../src/utils/productPriceMigration';

const soleraHalfBoxLegacy = {
    id: 'solera-half-regression',
    name: 'Cerveza Solera',
    priceUsd: 14,
    sellByBox: true,
    sellByHalfBox: true,
    halfBoxUnits: 18,
    halfBoxPriceUsd: 14,
    halfBoxPricingMode: 'bs_fijo',
    halfBoxPriceBsManual: 12180,
    _mode: 'halfBox',
};

const makeCheckoutOptions = (cart, totalBs = 12180) => ({
    cart,
    cartTotalUsd: 14,
    cartTotalBs: totalBs,
    cartSubtotalUsd: 14,
    payments: [{
        methodId: 'punto_venta',
        currency: 'BS',
        amountInput: totalBs,
        amountBs: totalBs,
        amountUsd: totalBs / 870,
    }],
    changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
    selectedCustomerId: null,
    customers: [],
    products: [{ id: 'solera-half-regression', name: 'Cerveza Solera', stock: 100 }],
    effectiveRate: 870,
    bcvRate: 870,
    tasaCop: 0,
    copEnabled: false,
    discountData: null,
    useAutoRate: false,
    paymentMethods: [],
});

describe('Regresión media caja Bs fijo — Solera $14 / Bs 12.180', () => {
    beforeEach(() => {
        memoryStore.clear();
    });

    it('resuelve el alias legacy al campo canónico sin mutar el producto', () => {
        const original = { ...soleraHalfBoxLegacy };
        const normalized = normalizeProduct(original);

        expect(normalized.halfBoxPriceBs).toBe(12180);
        expect(normalized.halfBoxPriceBsManual).toBe(12180);
        expect(original).toEqual(soleraHalfBoxLegacy);
    });

    it('prioriza el campo canónico cuando difiere del alias legacy', () => {
        const product = {
            ...soleraHalfBoxLegacy,
            halfBoxPriceBs: 13000,
            halfBoxPriceBsManual: 12180,
        };

        expect(normalizeProduct(product).halfBoxPriceBs).toBe(13000);
        expect(getFormatPriceAliasConflicts(product)).toEqual([{
            format: 'halfBox',
            canonicalKey: 'halfBoxPriceBs',
            legacyKey: 'halfBoxPriceBsManual',
            canonicalValue: 13000,
            legacyValue: 12180,
        }]);
    });

    it('migrar dos veces es idempotente y conserva campos no relacionados', () => {
        const product = { ...soleraHalfBoxLegacy, sku: 'SOLERA-½' };
        const once = migrateFormatPriceAliases(product);
        const twice = migrateFormatPriceAliases(once);

        expect(once).toEqual(twice);
        expect(twice.sku).toBe('SOLERA-½');
        expect(twice.halfBoxPriceBs).toBe(12180);
    });

    it('calcula media caja con Bs fijo aunque solo exista el alias legacy', () => {
        const pricing = calculatePricing(soleraHalfBoxLegacy, 870, 870, 'halfBox');

        expect(pricing.mode).toBe('bs_fijo');
        expect(pricing.unitPriceUsd).toBe(14);
        expect(pricing.unitPriceBs).toBe(12180);
        expect(pricing.pricingError).toBeNull();
    });

    it('calcula el total correcto del carrito y no lo convierte en Bs 0', () => {
        const cart = [{ ...soleraHalfBoxLegacy, id: 'solera-half-regression_half', qty: 1 }];
        const totals = FinancialEngine.buildCartTotals(cart, null, 870, 0, 870, 1);

        expect(totals.totalUsd).toBe(14);
        expect(totals.totalBs).toBe(12180);
        expect(totals.pricingErrors).toEqual([]);
    });

    it('cobra exactamente Bs 12.180 sin registrar vuelto artificial', async () => {
        await memoryStore.set('bodega_sales_v1', []);
        await memoryStore.set('bodega_products_v1', [{ id: 'solera-half-regression', stock: 100 }]);

        const cart = [{ ...soleraHalfBoxLegacy, id: 'solera-half-regression_half', qty: 1 }];
        const result = await processSaleTransaction(makeCheckoutOptions(cart));

        expect(result.success).toBe(true);
        expect(result.sale.totalUsd).toBe(14);
        expect(result.sale.totalBs).toBe(12180);
        expect(result.sale.changeBs).toBe(0);
        expect(result.sale.changeUsd).toBe(0);
    });

    it('bloquea checkout cuando el formato fijo no tiene precio Bs', async () => {
        const invalidCart = [{
            ...soleraHalfBoxLegacy,
            halfBoxPriceBsManual: null,
            halfBoxPricingMode: 'bs_fijo',
            id: 'solera-half-regression_half',
            qty: 1,
        }];
        await memoryStore.set('bodega_sales_v1', []);

        const totals = FinancialEngine.buildCartTotals(invalidCart, null, 870, 0, 870, 1);
        const result = await processSaleTransaction(makeCheckoutOptions(invalidCart, 0));

        expect(totals.pricingErrors).toHaveLength(1);
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/precio Bs válido/);
        expect(memoryStore.get('bodega_sales_v1')).toEqual([]);
    });
});
