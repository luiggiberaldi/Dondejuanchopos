import { describe, it, expect, vi } from 'vitest';
import { processSaleTransaction } from '../src/utils/checkoutProcessor.js';
import { FinancialEngine } from '../src/core/FinancialEngine.js';
import { getCustomerBalanceSnapshot } from '../src/utils/financialLogic.js';

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

    it('captura exacta: venta $5, pago $10, entrega $3 y $2 quedan registrados por fuera', async () => {
        const res = await processSaleTransaction({
            cart: [{ id: 'p1', name: 'Producto Test', priceUsd: 5, qty: 1, totalUsd: 5, totalBs: 200 }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            payments: [{ methodId: 'efectivo_usd', amountInput: 10, amountUsd: 10, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 3,
                changeBsGiven: 0,
                changeOwed: {
                    amountUsd: 2,
                    amountBs: 80,
                    method: 'pago_movil',
                    note: 'REF-VUELTO-002',
                },
            },
            selectedCustomerId: null,
            customers: [],
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40,
        });

        expect(res.success).toBe(true);
        expect(res.sale.changeRealUsd).toBe(5);
        expect(res.sale.changeRealBs).toBe(200);
        expect(res.sale.changeGiven).toEqual({ usd: 3, bs: 0 });
        expect(res.sale.changeLedger).toMatchObject({
            totalUsd: 5,
            totalBs: 200,
            allocatedUsd: 5,
            remainingUsd: 0,
            balanced: true,
        });
        expect(res.sale.changeLedger.parts.map(part => part.kind)).toEqual(['delivered', 'owed']);
        expect(res.sale.changeOwed).toMatchObject({
            amountUsd: 2,
            amountBs: 80,
            currency: 'USD',
            method: 'pago_movil',
            reference: 'REF-VUELTO-002',
            status: 'PENDIENTE',
        });
        expect(res.sale.changeCurrency).toBe('USD');
        expect(res.sale.changeOwed.createdAt).toBe(res.sale.createdAt);
        expect(res.sale.changeOwed.createdBy).toMatchObject({ nombre: 'Admin' });

        const breakdown = FinancialEngine.calculatePaymentBreakdown([res.sale]);
        expect(breakdown.efectivo_usd.total).toBe(10);
        expect(breakdown['_vuelto_usd'].total).toBe(3);
        expect(breakdown['_cambio_adeudado'].totalUsd).toBe(2);
        expect(breakdown['_cambio_adeudado'].displayUsd).toBe(2);
        expect(breakdown['_cambio_adeudado'].displayBs).toBe(0);
        // Los $2 externos no salen de la gaveta: entran $10 y salen $3.
        expect(FinancialEngine.computeExpectedCash(breakdown)).toMatchObject({ usd: 7, bs: 0 });
    });

    it('captura exacta: entrega $3 y abona los $2 restantes al saldo del cliente', async () => {
        const customer = { id: 'c-wallet', name: 'Chaylin', deuda: 0, favor: 1 };
        const res = await processSaleTransaction({
            cart: [{ id: 'p1', name: 'Producto Test', priceUsd: 5, qty: 1, totalUsd: 5, totalBs: 200 }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            payments: [{ methodId: 'efectivo_usd', amountInput: 10, amountUsd: 10, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 3,
                changeBsGiven: 0,
                vueltoParaMonederoUsd: 2,
                vueltoParaMonederoBs: 80,
                vueltoCredito: true,
            },
            selectedCustomerId: customer.id,
            customers: [customer],
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40,
        });

        expect(res.success).toBe(true);
        expect(res.sale.changeRealUsd).toBe(5);
        expect(res.sale.changeGiven).toEqual({ usd: 3, bs: 0 });
        expect(res.sale.vueltoParaMonedero).toBe(2);
        expect(res.sale.vueltoParaMonederoBs).toBe(80);
        expect(res.sale.changeLedger).toMatchObject({
            totalUsd: 5,
            totalBs: 200,
            allocatedUsd: 5,
            remainingUsd: 0,
            balanced: true,
        });
        expect(res.sale.changeLedger.parts.map(part => part.kind)).toEqual(['delivered', 'wallet']);
        expect(res.sale.vueltoParaMonederoDebtUsd).toBe(0);
        expect(res.sale.vueltoParaMonederoFavorUsd).toBe(2);

        const updatedCustomer = res.updatedCustomers.find(item => item.id === customer.id);
        expect(updatedCustomer).toMatchObject({ deuda: 0, favor: 3 });

        const breakdown = FinancialEngine.calculatePaymentBreakdown([res.sale]);
        expect(breakdown.efectivo_usd.total).toBe(10);
        expect(breakdown['_vuelto_usd'].total).toBe(3);
        expect(FinancialEngine.computeExpectedCash(breakdown)).toMatchObject({ usd: 7, bs: 0 });
    });

    it('expone deuda, favor y Cashea por separado para mostrar el saldo correcto', () => {
        expect(getCustomerBalanceSnapshot({ deuda: 3.456, favor: 0, casheaDeuda: 1.234 })).toMatchObject({
            deuda: 3.46,
            favor: 0,
            casheaDeuda: 1.23,
            neto: -3.46,
            tieneDeuda: true,
            tieneFavor: false,
            tieneCasheaDeuda: true,
        });
        expect(getCustomerBalanceSnapshot({ deuda: 0, favor: 2.5 })).toMatchObject({
            deuda: 0,
            favor: 2.5,
            neto: 2.5,
            tieneDeuda: false,
            tieneFavor: true,
        });
        expect(getCustomerBalanceSnapshot({ deuda: 0, saldoFavor: 1.25 }).favor).toBe(1.25);
        expect(getCustomerBalanceSnapshot({ deuda: -2, favor: 0 }).favor).toBe(2);
    });

    it('rechaza pagar por fuera si el monto no cubre todo el faltante', async () => {
        const res = await processSaleTransaction({
            cart: [{ id: 'p1', name: 'Producto Test', priceUsd: 5, qty: 1 }],
            cartTotalUsd: 5,
            cartTotalBs: 200,
            cartSubtotalUsd: 5,
            payments: [{ methodId: 'efectivo_usd', amountInput: 10, amountUsd: 10, currency: 'USD' }],
            changeBreakdown: {
                changeUsdGiven: 3,
                changeBsGiven: 0,
                changeOwed: { amountUsd: 1, amountBs: 40, method: 'pago_movil' },
            },
            selectedCustomerId: null,
            customers: [],
            products: mockProducts,
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 40,
        });

        expect(res.success).toBe(false);
        expect(res.error).toContain('no cuadra con el cambio real');
    });

    it('captura: un pago USD conserva el vuelto como una partición y registra la divergencia de precios duales', async () => {
        const res = await processSaleTransaction({
            cart: [{
                id: 'p1',
                name: 'Producto Test',
                priceUsd: 15.56,
                priceBsManual: 12000,
                pricingMode: 'bs_fijo',
                qty: 1,
                costUsd: 5,
            }],
            cartTotalUsd: 15.56,
            cartTotalBs: 12000,
            cartSubtotalUsd: 15.56,
            payments: [{ methodId: 'efectivo_usd', amountInput: 20, amountUsd: 20, currency: 'USD' }],
            changeBreakdown: { changeUsdGiven: 4.44, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: mockProducts,
            effectiveRate: 771.07,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
            bcvRate: 771.07,
        });

        expect(res.success).toBe(true);
        expect(res.sale.changeRealUsd).toBe(4.44);
        expect(res.sale.changeGiven).toEqual({ usd: 4.44, bs: 0 });
        expect(res.sale.bsVsUsdDiffBs).toBe(2.15);
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
