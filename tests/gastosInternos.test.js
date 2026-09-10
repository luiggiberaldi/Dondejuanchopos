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

    describe('isRecyclableSale Guard', () => {
        it('debe rechazar reciclaje para GASTO_INTERNO, incluso anulado o con items negativos', async () => {
            const { isRecyclableSale } = await import('../src/utils/voidSaleProcessor');
            
            const gastoInterno = {
                id: '64719f35-3a62-445b-9c4e-57393d59a6df',
                tipo: 'GASTO_INTERNO',
                status: 'ANULADA',
                items: [{ qty: 1, name: 'Gasto: gasolina', priceUsd: -10 }]
            };
            expect(isRecyclableSale(gastoInterno)).toBe(false);

            const egreso = {
                id: 'egreso-1',
                tipo: 'EGRESO',
                items: [{ qty: 1, name: 'Pago proveedor', priceUsd: -50 }]
            };
            expect(isRecyclableSale(egreso)).toBe(false);

            const apertura = {
                id: 'apertura-1',
                tipo: 'APERTURA_CAJA',
                items: undefined
            };
            expect(isRecyclableSale(apertura)).toBe(false);

            const cierre = {
                id: 'cierre-1',
                tipo: 'REGISTRO_CIERRE',
                items: []
            };
            expect(isRecyclableSale(cierre)).toBe(false);
        });

        it('debe aceptar reciclaje para ventas comerciales legítimas con productos', async () => {
            const { isRecyclableSale } = await import('../src/utils/voidSaleProcessor');

            const ventaNormal = {
                id: 'sale-1',
                tipo: 'VENTA',
                items: [{ id: 'p1', name: 'Harina PAN', priceUsd: 1.2, qty: 2 }]
            };
            expect(isRecyclableSale(ventaNormal)).toBe(true);

            const ventaLegacy = {
                id: 'sale-legacy',
                items: [{ id: 'p2', name: 'Arroz', priceUsd: 1.5, qty: 1 }]
            };
            expect(isRecyclableSale(ventaLegacy)).toBe(true);
        });
    });
});
