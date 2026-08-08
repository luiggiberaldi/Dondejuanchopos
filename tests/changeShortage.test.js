import { describe, it, expect, vi } from 'vitest';
import { processSaleTransaction } from '../src/utils/checkoutProcessor.js';
import { FinancialEngine } from '../src/core/FinancialEngine.js';

// Mock storageService & auditService & authStore
vi.mock('../src/utils/storageService.js', () => ({
    storageService: {
        getItem: vi.fn().mockImplementation((key, defaultVal) => Promise.resolve(defaultVal || [])),
        setItem: vi.fn().mockImplementation(() => Promise.resolve(true))
    }
}));

vi.mock('../src/services/auditService.js', () => ({
    logEvent: vi.fn()
}));

vi.mock('../src/hooks/store/useAuthStore.js', () => ({
    useAuthStore: {
        getState: () => ({
            usuarioActivo: { id: 1, nombre: 'Admin', rol: 'ADMIN' }
        })
    }
}));

const mockProducts = [
    { id: 'p1', name: 'Producto Test', priceUsd: 8.35, stock: 100, costUsd: 5 }
];

const mockCustomers = [
    { id: 'c1', name: 'Cliente Test', documentId: 'V123456', phone: '04141234567' }
];

const baseCart = [
    { id: 'p1', name: 'Producto Test', priceUsd: 8.35, qty: 1, totalUsd: 8.35, totalBs: 8.35 * 40 }
];

describe('FX19 — Manejo de Vuelto Incompleto', () => {
    it('S1_A: Donación parcial — cliente cede el faltante ($1.65)', async () => {
        const res = await processSaleTransaction({
            cart: baseCart,
            cartTotalUsd: 8.35,
            cartTotalBs: 8.35 * 40,
            cartSubtotalUsd: 8.35,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 20, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 10,
                changeBsGiven: 0,
                tipDonated: {
                    amountUsd: 1.65,
                    amountBs: 66,
                    currency: 'USD',
                    partial: true,
                    physicalGivenUsd: 10,
                    physicalGivenBs: 0,
                }
            },
            selectedCustomerId: 'c1',
            customers: mockCustomers,
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 4000,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(res.success).toBe(true);
        expect(res.sale.tipDonated.partial).toBe(true);
        expect(res.sale.tipDonated.amountUsd).toBe(1.65);
        expect(res.sale.changeGiven.usd).toBe(10);
    });

    it('S1_B: Donación total — vuelto completo cedido ($11.65)', async () => {
        const res = await processSaleTransaction({
            cart: baseCart,
            cartTotalUsd: 8.35,
            cartTotalBs: 8.35 * 40,
            cartSubtotalUsd: 8.35,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 20, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 0,
                changeBsGiven: 0,
                tipDonated: {
                    amountUsd: 11.65,
                    amountBs: 466,
                    currency: 'USD',
                    partial: false
                }
            },
            selectedCustomerId: 'c1',
            customers: mockCustomers,
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 4000,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(res.success).toBe(true);
        expect(res.sale.tipDonated.partial).toBe(false);
        expect(res.sale.tipDonated.amountUsd).toBe(11.65);
        expect(res.sale.changeGiven.usd).toBe(0);
    });

    it('S2_A: Vuelto adeudado — pago móvil ($1.65)', async () => {
        const res = await processSaleTransaction({
            cart: baseCart,
            cartTotalUsd: 8.35,
            cartTotalBs: 8.35 * 40,
            cartSubtotalUsd: 8.35,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 20, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 10,
                changeBsGiven: 0,
                changeOwed: {
                    amountUsd: 1.65,
                    amountBs: 66,
                    method: 'pago_movil',
                    note: 'Ref 12345',
                    resolvedAt: null
                }
            },
            selectedCustomerId: 'c1',
            customers: mockCustomers,
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 4000,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(res.success).toBe(true);
        expect(res.sale.changeOwed.amountUsd).toBe(1.65);
        expect(res.sale.changeOwed.method).toBe('pago_movil');

        const breakdown = FinancialEngine.calculatePaymentBreakdown([res.sale]);
        expect(breakdown['_cambio_adeudado']?.totalUsd).toBe(1.65);
        expect(breakdown['_vuelto_usd']?.total).toBe(10);
    });

    it('S3_A: Voucher emitido — $1.65 sin alterar gaveta', async () => {
        const res = await processSaleTransaction({
            cart: baseCart,
            cartTotalUsd: 8.35,
            cartTotalBs: 8.35 * 40,
            cartSubtotalUsd: 8.35,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 20, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 10,
                changeBsGiven: 0,
                changeVoucher: {
                    amountUsd: 1.65,
                    amountBs: 66,
                    voucherCode: 'VCH-TEST-001',
                    issuedAt: new Date().toISOString()
                }
            },
            selectedCustomerId: 'c1',
            customers: mockCustomers,
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 4000,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(res.success).toBe(true);
        expect(res.sale.changeVoucher.voucherCode).toBe('VCH-TEST-001');

        const breakdown = FinancialEngine.calculatePaymentBreakdown([res.sale]);
        expect(breakdown['_cambio_voucher']?.totalUsd).toBe(1.65);
    });

    it('GR_1: [Guardrail 1] Rechazar si vuelto dado + adeudado + donado excede cambio real', async () => {
        const res = await processSaleTransaction({
            cart: baseCart,
            cartTotalUsd: 8.35,
            cartTotalBs: 8.35 * 40,
            cartSubtotalUsd: 8.35,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 20, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 10,
                changeBsGiven: 0,
                changeOwed: { amountUsd: 5.00, amountBs: 200 } // Total 15 > 11.65
            },
            selectedCustomerId: 'c1',
            customers: mockCustomers,
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 4000,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(res.success).toBe(false);
        expect(res.error).toContain('excede el cambio real');
    });

    it('GR_3: [Guardrail 3] Rechazar si physicalGivenUsd + tipDonated.amountUsd no cuadra', async () => {
        const res = await processSaleTransaction({
            cart: baseCart,
            cartTotalUsd: 8.35,
            cartTotalBs: 8.35 * 40,
            cartSubtotalUsd: 8.35,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 20, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 5,
                tipDonated: {
                    amountUsd: 5.00, // 5 + 5 = 10 != 11.65
                    partial: true,
                    physicalGivenUsd: 5
                }
            },
            selectedCustomerId: 'c1',
            customers: mockCustomers,
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 4000,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(res.success).toBe(false);
        expect(res.error).toContain('no cuadra con el cambio real');
    });

    it('GR_4: [Guardrail 4] Verificar que _cambio_adeudado NO afecta saldo en gaveta', async () => {
        const res = await processSaleTransaction({
            cart: baseCart,
            cartTotalUsd: 8.35,
            cartTotalBs: 8.35 * 40,
            cartSubtotalUsd: 8.35,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 20, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 10,
                changeOwed: { amountUsd: 1.65, method: 'zelle' }
            },
            selectedCustomerId: 'c1',
            customers: mockCustomers,
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 4000,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(res.success).toBe(true);
        const breakdown = FinancialEngine.calculatePaymentBreakdown([res.sale]);
        const efectivoUsd = breakdown['efectivo_usd']?.total || 0;
        const vueltoUsd = breakdown['_vuelto_usd']?.total || 0;
        const netUsdInGaveta = efectivoUsd - vueltoUsd;
        expect(netUsdInGaveta).toBe(10);
    });

    it('GR_5: [Guardrail 5] Rechazar cobro si intenta enviar tipDonated y changeOwed simultáneamente duplicando el faltante', async () => {
        const res = await processSaleTransaction({
            cart: baseCart,
            cartTotalUsd: 8.35,
            cartTotalBs: 8.35 * 40,
            cartSubtotalUsd: 8.35,
            payments: [{ methodId: 'efectivo_usd', amountUsd: 20, currency: 'USD' }], // Vuelto = 11.65
            changeBreakdown: {
                changeUsdGiven: 10,
                tipDonated: { amountUsd: 1.65, partial: true },
                changeOwed: { amountUsd: 1.65, method: 'pago_movil' } // 10 + 1.65 + 1.65 = 13.30 > 11.65
            },
            selectedCustomerId: 'c1',
            customers: mockCustomers,
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 4000,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40
        });

        expect(res.success).toBe(false);
        expect(res.error).toContain('excede el cambio real');
    });
});
