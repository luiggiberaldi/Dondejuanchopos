import { describe, expect, it } from 'vitest';
import { getChangeLedger, getChangeDisplayParts, summarizeChangeLedgers } from '../src/utils/changeLedger.js';
import { assertCheckoutInvariants } from '../src/core/CheckoutPaymentEngine.js';
import { FinancialEngine } from '../src/core/FinancialEngine.js';

const rate = 771.07;

describe('changeLedger — trazabilidad y partición exacta del vuelto', () => {
    it('registra $3 entregados y $2 por fuera sin duplicar el total de $5', () => {
        const sale = {
            id: 'sale-owed',
            rate,
            changeRealUsd: 5,
            changeRealBs: 3855.35,
            changeGiven: { usd: 3, bs: 0 },
            changeOwed: {
                amountUsd: 2,
                amountBs: 1542.14,
                method: 'pago_movil',
                reference: 'REF-002',
                status: 'PENDIENTE',
            },
        };

        const ledger = getChangeLedger(sale);

        expect(ledger.totalUsd).toBe(5);
        expect(ledger.delivered).toMatchObject({ usd: 3, bs: 0 });
        expect(ledger.owed).toMatchObject({ usd: 2, bs: 1542.14, method: 'pago_movil', reference: 'REF-002' });
        expect(ledger.allocatedUsd).toBe(5);
        expect(ledger.remainingUsd).toBe(0);
        expect(ledger.balanced).toBe(true);
        expect(ledger.parts.map((part) => part.kind)).toEqual(['delivered', 'owed']);
    });

    it('registra por separado efectivo, abono, voucher y donación en variantes completas', () => {
        const variants = [
            {
                changeRealUsd: 5,
                changeRealBs: 200,
                changeGiven: { usd: 3, bs: 0 },
                changeOwed: { amountUsd: 2, amountBs: 80, method: 'zelle' },
            },
            {
                changeRealUsd: 5,
                changeRealBs: 200,
                changeGiven: { usd: 3, bs: 0 },
                vueltoParaMonedero: 2,
                vueltoParaMonederoBs: 80,
            },
            {
                changeRealUsd: 5,
                changeRealBs: 200,
                changeGiven: { usd: 3, bs: 0 },
                changeVoucher: { amountUsd: 2, amountBs: 80, voucherCode: 'VCH-2' },
            },
            {
                changeRealUsd: 5,
                changeRealBs: 200,
                changeGiven: { usd: 3, bs: 0 },
                tipDonated: { amountUsd: 2, amountBs: 80, currency: 'USD' },
            },
        ];

        for (const sale of variants) {
            const ledger = getChangeLedger({ ...sale, rate: 40 });
            expect(ledger.allocatedUsd).toBe(5);
            expect(ledger.remainingUsd).toBe(0);
            expect(ledger.balanced).toBe(true);
            expect(ledger.parts).toHaveLength(2);
        }
    });

    it('no convierte Bs→USD→Bs para un vuelto puro en Bs', () => {
        const ledger = getChangeLedger({
            rate: 45,
            changeRealUsd: 1.11,
            changeRealBs: 50,
            changeGiven: { usd: 0, bs: 50 },
        });

        expect(ledger.delivered.usd).toBe(0);
        expect(ledger.delivered.bs).toBe(50);
        expect(ledger.allocatedBs).toBe(50);
        expect(ledger.remainingBs).toBe(0);
        expect(ledger.balanced).toBe(true);
    });

    it('elige Bs para destinos de una venta pagada completamente en Bs', () => {
        const ledger = getChangeLedger({
            rate: 40,
            paymentRegime: 'PURE_BS',
            payments: [{ methodId: 'efectivo_bs', currency: 'BS', amountInput: 600 }],
            changeRealUsd: 5,
            changeRealBs: 200,
            changeGiven: { usd: 0, bs: 100 },
            changeOwed: { amountUsd: 2.5, amountBs: 100, method: 'pago_movil' },
        });

        expect(ledger.owed.currency).toBe('BS');
        expect(getChangeDisplayParts(ledger.owed)).toEqual([{ currency: 'BS', amount: 100 }]);
        expect(getChangeDisplayParts(ledger.delivered, { physical: true })).toEqual([{ currency: 'BS', amount: 100 }]);
    });

    it('elige USD para un destino legacy USD/Bs equivalente y no imprime ambos', () => {
        const ledger = getChangeLedger({
            rate: 40,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountInput: 10 }],
            changeRealUsd: 5,
            changeRealBs: 200,
            changeGiven: { usd: 3, bs: 0 },
            changeOwed: { amountUsd: 2, amountBs: 80, method: 'pago_movil' },
        });

        expect(ledger.owed.currency).toBe('USD');
        expect(getChangeDisplayParts(ledger.owed)).toEqual([{ currency: 'USD', amount: 2 }]);
    });

    it('mantiene equilibrado un abono USD persistido sin Bs equivalente', () => {
        const ledger = getChangeLedger({
            rate: 40,
            changeRealUsd: 5,
            changeRealBs: 200,
            changeGiven: { usd: 3, bs: 0 },
            vueltoParaMonedero: 2,
            vueltoParaMonederoBs: 0,
        });

        expect(ledger.wallet).toMatchObject({ usd: 2, bs: 0 });
        expect(ledger.allocatedUsd).toBe(5);
        expect(ledger.allocatedBs).toBe(200);
        expect(ledger.remainingUsd).toBe(0);
        expect(ledger.balanced).toBe(true);
    });

    it('acepta un destino legacy solo en Bs y lo muestra como equivalente, sin $0 implícito', () => {
        const ledger = getChangeLedger({
            rate: 40,
            changeRealUsd: 5,
            changeRealBs: 200,
            changeGiven: { usd: 3, bs: 0 },
            changeVoucher: { amountUsd: 0, amountBs: 80, voucherCode: 'VCH-BS' },
        });

        expect(ledger.voucher).toMatchObject({ usd: 0, bs: 80, code: 'VCH-BS' });
        expect(ledger.allocatedUsd).toBe(5);
        expect(ledger.allocatedBs).toBe(200);
        expect(ledger.remainingUsd).toBe(0);
        expect(ledger.balanced).toBe(true);
    });

    it('trata un registro legacy con USD y Bs equivalentes como una sola salida', () => {
        const ledger = getChangeLedger({
            rate,
            changeRealUsd: 4.44,
            changeUsd: 4.44,
            changeBs: 3423.55,
        });

        expect(ledger.legacyEquivalent).toBe(true);
        expect(ledger.delivered.usd).toBe(0);
        expect(ledger.delivered.bs).toBe(3423.55);
        expect(ledger.allocatedUsd).toBe(4.44);
        expect(ledger.balanced).toBe(true);
    });

    it('conserva un vuelto físico en COP como COP y lo excluye de la caja neta', () => {
        const sale = {
            rate: 40,
            tasaCop: 4000,
            changeRealUsd: 1,
            changeRealBs: 40,
            changeGiven: { usd: 0, bs: 0, cop: 4000 },
        };
        const ledger = getChangeLedger(sale);

        expect(ledger.delivered).toMatchObject({ usd: 0, bs: 0, cop: 4000 });
        expect(ledger.delivered.usdEquivalent).toBe(1);
        expect(ledger.hasChange).toBe(true);
        expect(ledger.parts).toHaveLength(1);

        const breakdown = FinancialEngine.calculatePaymentBreakdown([{
            ...sale,
            id: 'sale-cop-change',
            totalUsd: 10,
            totalBs: 400,
            payments: [{
                methodId: 'efectivo_cop',
                currency: 'COP',
                amountUsd: 11,
                amountBs: 440,
                amountInput: 44000,
            }],
        }]);
        expect(breakdown.efectivo_cop.total).toBe(44000);
        expect(breakdown._vuelto_cop.total).toBe(4000);
        expect(FinancialEngine.computeExpectedCash(breakdown).cop).toBe(40000);
    });

    it('resume ventas sin contar anuladas y conserva la separación de destinos', () => {
        const summary = summarizeChangeLedgers([
            {
                rate: 40,
                changeRealUsd: 5,
                changeRealBs: 200,
                changeGiven: { usd: 3, bs: 0 },
                changeOwed: { amountUsd: 2, amountBs: 80, method: 'pago_movil' },
            },
            {
                status: 'ANULADA',
                rate: 40,
                changeRealUsd: 10,
                changeRealBs: 400,
                changeGiven: { usd: 10, bs: 0 },
            },
        ], 40);

        expect(summary).toMatchObject({
            count: 1,
            totalUsd: 5,
            deliveredUsd: 3,
            owedUsd: 2,
            owedDisplayUsd: 2,
            owedDisplayBs: 0,
            unresolvedUsd: 0,
            unbalancedCount: 0,
        });
    });

    it('resume el destino en su moneda visible sin sumar su equivalente contable', () => {
        const usdSummary = summarizeChangeLedgers([{
            rate: 40,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountInput: 10 }],
            changeRealUsd: 5,
            changeRealBs: 200,
            changeGiven: { usd: 3, bs: 0 },
            changeOwed: { amountUsd: 2, amountBs: 80, method: 'pago_movil' },
        }], 40);
        expect(usdSummary).toMatchObject({ owedDisplayUsd: 2, owedDisplayBs: 0 });

        const bsSummary = summarizeChangeLedgers([{
            rate: 40,
            paymentRegime: 'PURE_BS',
            payments: [{ methodId: 'efectivo_bs', currency: 'BS', amountInput: 600 }],
            changeRealUsd: 5,
            changeRealBs: 200,
            changeGiven: { usd: 0, bs: 100 },
            changeOwed: { amountUsd: 2.5, amountBs: 100, method: 'pago_movil' },
        }], 40);
        expect(bsSummary).toMatchObject({ owedDisplayUsd: 0, owedDisplayBs: 100 });
    });
});

describe('changeLedger — caja y guardrails de entrada', () => {
    it('registra destinos Bs-only en el reporte sin convertirlos en ingreso de gaveta', () => {
        const breakdown = FinancialEngine.calculatePaymentBreakdown([{
            id: 'sale-bs-destination',
            totalUsd: 5,
            totalBs: 200,
            rate: 40,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 10 }],
            changeGiven: { usd: 3, bs: 0 },
            changeRealUsd: 5,
            changeRealBs: 200,
            changeVoucher: { amountUsd: 0, amountBs: 80, voucherCode: 'VCH-BS' },
        }]);

        expect(breakdown.efectivo_usd.total).toBe(10);
        expect(breakdown._vuelto_usd.total).toBe(3);
        expect(breakdown._cambio_voucher).toMatchObject({ totalUsd: 0, totalBs: 80 });
        expect(FinancialEngine.computeExpectedCash(breakdown)).toMatchObject({ usd: 7, bs: 0 });
    });
    it('rechaza equivalentes USD/Bs inconsistentes', () => {
        const result = assertCheckoutInvariants({
            changeUsd: 5,
            changeTotalBs: 200,
            rate: 40,
            changeBreakdown: {
                changeUsdGiven: 3,
                changeBsGiven: 0,
                owedUsd: 2,
                owedBs: 40,
            },
            requireComplete: true,
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain('no cuadra entre USD y bolívares');
    });

    it('rechaza dos destinos pendientes aunque la suma matemática cuadre', () => {
        const result = assertCheckoutInvariants({
            changeUsd: 5,
            changeTotalBs: 200,
            rate: 40,
            changeBreakdown: {
                changeUsdGiven: 3,
                changeBsGiven: 0,
                owedUsd: 1,
                owedBs: 40,
                walletUsd: 1,
                walletBs: 40,
            },
            requireComplete: true,
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain('un destino pendiente a la vez');
    });
});
