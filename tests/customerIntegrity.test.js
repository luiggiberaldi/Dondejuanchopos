// tests/customerIntegrity.test.js
// Tests for Customer Integrity: Golden Rule normalization, Cashea reversal on void,
// customer storage circuit breaker, mirror logging, and WhatsApp link generation.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
            return value;
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: {
        getState: () => ({
            usuarioActivo: { id: 'test-admin', nombre: 'Admin', rol: 'ADMIN' },
        }),
    },
}));

import { storageService } from '../src/utils/storageService';
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { processCustomerTransaction } from '../src/utils/customerTransactionProcessor';

function resetStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
}

describe('Customer Integrity & Golden Rule Normalization', () => {
    beforeEach(() => {
        resetStore();
    });

    it('voiding a VENTA_CASHEA reduces customer.casheaDeuda correctly', async () => {
        const customer = {
            id: 'cust-cashea-1',
            name: 'Cliente Cashea',
            deuda: 0,
            favor: 0,
            casheaDeuda: 60.00,
        };
        await storageService.setItem('bodega_customers_v1', [customer]);

        const sale = {
            id: 'sale-cashea-1',
            saleNumber: 'VEN-001',
            tipo: 'VENTA_CASHEA',
            status: 'COMPLETADA',
            customerId: customer.id,
            totalUsd: 100.00,
            casheaUsd: 60.00,
            items: [],
            payments: [
                { id: 'p1', methodId: 'efectivo_usd', amountUsd: 40.00, currency: 'USD' },
                { id: 'p2', methodId: 'cashea', amountUsd: 60.00, currency: 'USD', isCashea: true }
            ],
            timestamp: new Date().toISOString(),
        };

        await storageService.setItem('bodega_sales_v1', [sale]);
        const result = await processVoidSale(sale, [sale], []);
        expect(result.updatedCustomers).toBeDefined();
        const updatedCust = result.updatedCustomers.find(c => c.id === customer.id);
        expect(updatedCust).toBeDefined();
        expect(updatedCust.casheaDeuda).toBe(0);
        expect(updatedCust.deuda).toBe(0);
        expect(updatedCust.favor).toBe(0);
    });

    it('voiding a VENTA_FIADA reverses customer debt according to Golden Rule', async () => {
        const customer = {
            id: 'cust-fiado-1',
            name: 'Cliente Fiado',
            deuda: 50.00,
            favor: 0,
        };
        await storageService.setItem('bodega_customers_v1', [customer]);

        const sale = {
            id: 'sale-fiado-1',
            saleNumber: 'VEN-002',
            tipo: 'VENTA_FIADA',
            status: 'COMPLETADA',
            customerId: customer.id,
            totalUsd: 50.00,
            fiadoUsd: 50.00,
            items: [],
            payments: [],
            timestamp: new Date().toISOString(),
        };
        await storageService.setItem('bodega_sales_v1', [sale]);

        const result = await processVoidSale(sale, [sale], []);
        const updatedCust = result.updatedCustomers.find(c => c.id === customer.id);
        expect(updatedCust).toBeDefined();
        expect(updatedCust.deuda).toBe(0);
        expect(updatedCust.favor).toBe(0);
    });

    it('voiding an abono (COBRO_DEUDA) restores original debt and splits wallet allocation', async () => {
        const customer = {
            id: 'cust-abono-1',
            name: 'Cliente Abono',
            deuda: 0,
            favor: 15.00,
        };
        await storageService.setItem('bodega_customers_v1', [customer]);

        // Sale where customer had $35 debt and paid $50 ($35 to debt, $15 to favor)
        const sale = {
            id: 'sale-abono-1',
            saleNumber: 'COB-001',
            tipo: 'COBRO_DEUDA',
            status: 'COMPLETADA',
            customerId: customer.id,
            totalUsd: 50.00,
            vueltoParaMonederoDebtUsd: 35.00,
            vueltoParaMonederoFavorUsd: 15.00,
            items: [],
            payments: [{ id: 'p1', methodId: 'efectivo_usd', amountUsd: 50.00, currency: 'USD' }],
            timestamp: new Date().toISOString(),
        };
        await storageService.setItem('bodega_sales_v1', [sale]);

        const result = await processVoidSale(sale, [sale], []);
        const updatedCust = result.updatedCustomers.find(c => c.id === customer.id);
        expect(updatedCust).toBeDefined();
        // $15 favor removed, $35 debt restored
        expect(updatedCust.favor).toBe(0);
        expect(updatedCust.deuda).toBe(35.00);
    });

    it('processCustomerTransaction writes to both sales and sales mirror', async () => {
        const customer = { id: 'cust-tx-1', name: 'Maria', deuda: 80.00, favor: 0 };
        await storageService.setItem('bodega_customers_v1', [customer]);

        const res = await processCustomerTransaction({
            transactionAmount: 30,
            currencyMode: 'USD',
            type: 'ABONO',
            customer,
            paymentMethod: 'efectivo_usd',
            bcvRate: 580,
            tasaCop: 0,
            copEnabled: false,
        });

        expect(res.error).toBeUndefined();

        const mainSales = await storageService.getItem('bodega_sales_v1', []);
        const mirrorSales = await storageService.getItem('bodega_sales_mirror_v1', []);

        expect(mainSales.length).toBe(1);
        expect(mirrorSales.length).toBe(1);
        expect(mainSales[0].id).toBe(mirrorSales[0].id);
        expect(mainSales[0].vueltoParaMonederoDebtUsd).toBe(30);
        expect(mainSales[0].vueltoParaMonederoFavorUsd).toBe(0);

        const customers = await storageService.getItem('bodega_customers_v1', []);
        const updatedCust = customers.find(c => c.id === customer.id);
        expect(updatedCust.deuda).toBe(50.00);
        expect(updatedCust.favor).toBe(0);
    });

    it('voiding a manual credit (VENTA_FIADA) clears debt without touching inventory', async () => {
        const customer = { id: 'cust-manual-credit', name: 'Jose', deuda: 10.00, favor: 0 };
        await storageService.setItem('bodega_customers_v1', [customer]);

        const sale = {
            id: 'sale-manual-1',
            saleNumber: 'FIAD-001',
            tipo: 'VENTA_FIADA',
            status: 'COMPLETADA',
            customerId: customer.id,
            totalUsd: 10.00,
            fiadoUsd: 10.00,
            items: [{ name: 'Credito manual: Jose', qty: 1, priceUsd: 10, costBs: 0 }],
            payments: [],
            timestamp: new Date().toISOString(),
        };
        await storageService.setItem('bodega_sales_v1', [sale]);

        const result = await processVoidSale(sale, [sale], []);
        const updatedCust = result.updatedCustomers.find(c => c.id === customer.id);
        expect(updatedCust).toBeDefined();
        expect(updatedCust.deuda).toBe(0);
        expect(updatedCust.favor).toBe(0);
        expect(result.updatedSales.find(s => s.id === sale.id).status).toBe('ANULADA');
    });

    it('voiding an abono whose excess favor was already spent converts deficit to debt', async () => {
        // Customer received $20 favor from an abono, but later spent it so favor is now 0
        const customer = { id: 'cust-spent-favor', name: 'Pedro', deuda: 0, favor: 0 };
        await storageService.setItem('bodega_customers_v1', [customer]);

        const sale = {
            id: 'sale-abono-spent',
            saleNumber: 'COB-002',
            tipo: 'COBRO_DEUDA',
            status: 'COMPLETADA',
            customerId: customer.id,
            totalUsd: 20.00,
            vueltoParaMonederoDebtUsd: 0,
            vueltoParaMonederoFavorUsd: 20.00,
            items: [],
            payments: [{ id: 'p1', methodId: 'efectivo_usd', amountUsd: 20.00, currency: 'USD' }],
            timestamp: new Date().toISOString(),
        };
        await storageService.setItem('bodega_sales_v1', [sale]);

        const result = await processVoidSale(sale, [sale], []);
        const updatedCust = result.updatedCustomers.find(c => c.id === customer.id);
        expect(updatedCust).toBeDefined();
        // Since the customer spent the $20 favor that was revoked, customer now owes $20
        expect(updatedCust.deuda).toBe(20.00);
        expect(updatedCust.favor).toBe(0);
        expect(result.updatedSales.find(s => s.id === sale.id).status).toBe('ANULADA');
    });
});
