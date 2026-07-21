import { describe, it, expect } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { subR, sumR } from '../src/utils/dinero';

describe('Gastos Internos & Autoconsumo Engine Integration', () => {
    it('debe restar el monto del gasto de caja física en calculatePaymentBreakdown', () => {
        const sales = [
            {
                id: 'sale-1',
                tipo: 'VENTA',
                totalUsd: 10,
                totalBs: 400,
                payments: [{ methodId: 'efectivo_usd', amountUsd: 10, amountBs: 400, currency: 'USD' }]
            },
            {
                id: 'gasto-1',
                tipo: 'GASTO_INTERNO',
                afectaCaja: true,
                totalUsd: -3,
                totalBs: -120,
                payments: [{ methodId: 'efectivo_usd', amountUsd: -3, amountBs: -120, currency: 'USD' }]
            }
        ];

        const breakdown = FinancialEngine.calculatePaymentBreakdown(sales);
        expect(breakdown['efectivo_usd']).toBeDefined();
        expect(breakdown['efectivo_usd'].total).toBe(7); // 10 - 3 = 7 USD
    });

    it('NO debe restar del arqueo de caja física cuando el gasto es de Autoconsumo (afectaCaja: false)', () => {
        const sales = [
            {
                id: 'sale-1',
                tipo: 'VENTA',
                totalUsd: 20,
                totalBs: 800,
                payments: [{ methodId: 'efectivo_usd', amountUsd: 20, amountBs: 800, currency: 'USD' }]
            },
            {
                id: 'autoconsumo-1',
                tipo: 'GASTO_INTERNO',
                isAutoconsumo: true,
                afectaCaja: false,
                totalUsd: -5,
                totalBs: -200,
                payments: [{ methodId: 'autoconsumo', amountUsd: -5, amountBs: -200, currency: 'USD' }]
            }
        ];

        const breakdown = FinancialEngine.calculatePaymentBreakdown(sales);
        expect(breakdown['efectivo_usd'].total).toBe(20); // Caja intacta en $20
        expect(breakdown['autoconsumo']).toBeUndefined(); // Autoconsumo no crea bucket de caja
    });

    it('debe calcular la reducción de stock y su reversión con math exacto', () => {
        const initialStock = 10;
        const qtyToWithdraw = 2;

        const stockAfterRetiro = subR(initialStock, qtyToWithdraw);
        expect(stockAfterRetiro).toBe(8);

        const stockAfterAnulacion = sumR(stockAfterRetiro, qtyToWithdraw);
        expect(stockAfterAnulacion).toBe(10);
    });
});
