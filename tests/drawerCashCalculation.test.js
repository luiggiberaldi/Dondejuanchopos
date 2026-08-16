import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { getOpenShiftMovements } from '../src/utils/shiftScope';

describe('FinancialEngine Drawer Cash Calculation', () => {
    it('excludes digital custom payment methods (even with typo like Trasferencia) from physical cash drawer', () => {
        const sales = [
            {
                tipo: 'APERTURA_CAJA',
                openingBs: 3000,
                openingUsd: 26,
                openingCop: 0,
                cajaCerrada: false
            },
            {
                id: 'sale-1',
                tipo: 'VENTA',
                totalBs: 940,
                totalUsd: 1.05,
                payments: [
                    {
                        methodId: 'efectivo_bs',
                        methodLabel: 'Efectivo en Bolívares',
                        amountBs: 940,
                        amountUsd: 1.05,
                        currency: 'BS',
                        isCash: true
                    }
                ],
                changeBs: 0,
                changeUsd: 0
            },
            {
                id: 'sale-2',
                tipo: 'VENTA',
                totalBs: 23140,
                totalUsd: 26,
                payments: [
                    {
                        methodId: 'custom_1783878638542',
                        methodLabel: 'Trasferencia', // Typo without 'n'
                        amountBs: 23140,
                        amountUsd: 26,
                        currency: 'BS',
                        isCash: false
                    }
                ],
                changeBs: 0,
                changeUsd: 0
            },
            {
                id: 'sale-3',
                tipo: 'VENTA',
                totalBs: 5270,
                totalUsd: 5.93,
                payments: [
                    {
                        methodId: 'efectivo_usd',
                        methodLabel: 'Efectivo en Dólares',
                        amountBs: 8900,
                        amountUsd: 10,
                        currency: 'USD',
                        isCash: true
                    }
                ],
                changeBs: 275.9,
                changeUsd: 4
            }
        ];

        const breakdown = FinancialEngine.calculatePaymentBreakdown(sales);
        const expectedCash = FinancialEngine.computeExpectedCash(breakdown);

        // Expected Bs: 3000 (Apertura) + 940 (Efectivo Bs) - 275.90 (Vuelto Bs) = 3664.10 Bs
        // The 23,140 Bs transfer MUST NOT be added.
        expect(expectedCash.bs).toBe(3664.1);

        // Expected USD: 26 (Apertura) + 10 (Efectivo USD) - 4 (Vuelto USD) = 32 USD
        expect(expectedCash.usd).toBe(32);
    });

    it('correctly calculates expected cash on real recorded active shift data', () => {
        const dumpPath = 'C:/Users/luigg/.gemini/antigravity/brain/28bbdbca-b48b-4c0e-a0bd-6d13d812ef0b/scratch/sales_dump.json';
        if (!fs.existsSync(dumpPath)) return;

        const raw = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
        const sales = Array.isArray(raw) ? raw : (raw.payload || raw.data || raw.sales || []);

        const { movements } = getOpenShiftMovements(sales);
        const breakdown = FinancialEngine.calculatePaymentBreakdown(movements);
        const expectedCash = FinancialEngine.computeExpectedCash(breakdown);

        // In the real shift dump:
        // Apertura Bs: 3,000 Bs
        // Efectivo Bs cobrado: 940 Bs
        // Vueltos en Bs: 275.90 Bs
        // Total esperado en billetes Bs = 3,000 + 940 - 275.90 = 3,664.10 Bs
        expect(expectedCash.bs).toBe(3664.1);

        // Apertura USD: $26
        // Efectivo USD cobrado: $38
        // Vueltos en USD: $17
        // Total esperado en billetes USD = $26 + $38 - $17 = $47.00 USD
        expect(expectedCash.usd).toBe(47);
    });
});
