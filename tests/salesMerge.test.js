import { describe, expect, it } from 'vitest';
import { mergeSalesArrays, isSalesArrayShrinking, isCierresCountShrinking } from '../src/utils/salesMerge';

describe('salesMerge (Guardarraíl de Sincronización No Destructiva)', () => {
    it('nunca elimina ventas locales cuando llega un pull remoto más viejo o con menos ventas', () => {
        const localSales = [
            { id: 'sale-1', saleNumber: 1, totalUsd: 10, timestamp: '2026-09-05T01:00:00.000Z' },
            { id: 'sale-2', saleNumber: 2, totalUsd: 20, timestamp: '2026-09-05T01:10:00.000Z' },
            { id: 'sale-3', saleNumber: 3, totalUsd: 30, timestamp: '2026-09-05T01:20:00.000Z' },
        ];

        // Incoming remoto viejo que solo tiene sale-1
        const incomingSales = [
            { id: 'sale-1', saleNumber: 1, totalUsd: 10, timestamp: '2026-09-05T01:00:00.000Z' }
        ];

        const merged = mergeSalesArrays(incomingSales, localSales);

        expect(merged).toHaveLength(3);
        const ids = merged.map(s => s.id);
        expect(ids).toContain('sale-1');
        expect(ids).toContain('sale-2');
        expect(ids).toContain('sale-3');
    });

    it('incorpora ventas nuevas remotas sin perder las locales', () => {
        const localSales = [
            { id: 'sale-local', saleNumber: 1, totalUsd: 10, timestamp: '2026-09-05T01:00:00.000Z' }
        ];

        const incomingSales = [
            { id: 'sale-remote', saleNumber: 2, totalUsd: 25, timestamp: '2026-09-05T01:05:00.000Z' }
        ];

        const merged = mergeSalesArrays(incomingSales, localSales);

        expect(merged).toHaveLength(2);
        expect(merged.map(s => s.id)).toEqual(['sale-remote', 'sale-local']);
    });

    it('preserva cajaCerrada: true si la venta ya fue cerrada localmente', () => {
        const localSales = [
            { id: 'sale-1', saleNumber: 1, totalUsd: 10, cajaCerrada: true, cierreId: 100, cierreNumber: 5, timestamp: '2026-09-05T01:00:00.000Z' }
        ];

        // Incoming remoto con la venta aún abierta (sin cajaCerrada)
        const incomingSales = [
            { id: 'sale-1', saleNumber: 1, totalUsd: 10, cajaCerrada: false, timestamp: '2026-09-05T01:00:00.000Z' }
        ];

        const merged = mergeSalesArrays(incomingSales, localSales);

        expect(merged[0].cajaCerrada).toBe(true);
        expect(merged[0].cierreId).toBe(100);
        expect(merged[0].cierreNumber).toBe(5);
    });

    it('preserva status: ANULADA si la venta fue anulada', () => {
        const localSales = [
            { id: 'sale-1', saleNumber: 1, status: 'ANULADA', anuladaPor: 'Supervisor', timestamp: '2026-09-05T01:00:00.000Z' }
        ];

        const incomingSales = [
            { id: 'sale-1', saleNumber: 1, status: 'COMPLETADA', timestamp: '2026-09-05T01:00:00.000Z' }
        ];

        const merged = mergeSalesArrays(incomingSales, localSales);

        expect(merged[0].status).toBe('ANULADA');
        expect(merged[0].anuladaPor).toBe('Supervisor');
    });

    it('preserva inventoryDeductionsApplied y checkoutOperationId', () => {
        const localSales = [
            {
                id: 'sale-1',
                checkoutOperationId: 'chk-123',
                inventoryOperationId: 'sale_sale-1',
                inventoryDeductionsApplied: [{ productoId: 'prod-1', cantidad: -2 }],
                timestamp: '2026-09-05T01:00:00.000Z'
            }
        ];

        const incomingSales = [
            { id: 'sale-1', timestamp: '2026-09-05T01:00:00.000Z' }
        ];

        const merged = mergeSalesArrays(incomingSales, localSales);

        expect(merged[0].checkoutOperationId).toBe('chk-123');
        expect(merged[0].inventoryOperationId).toBe('sale_sale-1');
        expect(merged[0].inventoryDeductionsApplied).toHaveLength(1);
        expect(merged[0].inventoryDeductionsApplied[0].cantidad).toBe(-2);
    });

    it('detecta correctamente si un array de ventas se está encogiendo', () => {
        const existing = [1, 2, 3, 4, 5];
        const smaller = [1, 2, 3];
        const sameOrLarger = [1, 2, 3, 4, 5, 6];

        expect(isSalesArrayShrinking(smaller, existing)).toBe(true);
        expect(isSalesArrayShrinking(sameOrLarger, existing)).toBe(false);
        expect(isSalesArrayShrinking([], existing)).toBe(true);
        expect(isSalesArrayShrinking(null, existing)).toBe(false);
    });

    it('preserva cierreId y cajaCerrada aunque la versión incoming sea más reciente y venga sin cierreId', () => {
        const localSales = [
            {
                id: 'sale-closed-historical',
                saleNumber: 700,
                totalUsd: 15,
                cajaCerrada: true,
                cierreId: 'cierre_test_37',
                cierreNumber: 37,
                timestamp: '2026-09-08T10:00:00.000Z',
                updatedAt: '2026-09-08T10:00:00.000Z'
            }
        ];

        // Incoming remoto más reciente pero con datos incompletos (sin cierreId)
        const incomingSales = [
            {
                id: 'sale-closed-historical',
                saleNumber: 700,
                totalUsd: 15,
                timestamp: '2026-09-08T10:00:00.000Z',
                updatedAt: '2026-09-11T12:00:00.000Z' // más nuevo
            }
        ];

        const merged = mergeSalesArrays(incomingSales, localSales);

        expect(merged).toHaveLength(1);
        expect(merged[0].cajaCerrada).toBe(true);
        expect(merged[0].cierreId).toBe('cierre_test_37');
        expect(merged[0].cierreNumber).toBe(37);
    });

    it('adopta cierreId y cierreNumber si incoming los tiene y local no', () => {
        const localSales = [
            {
                id: 'sale-open-local',
                saleNumber: 750,
                totalUsd: 20,
                cajaCerrada: false,
                timestamp: '2026-09-09T10:00:00.000Z'
            }
        ];

        const incomingSales = [
            {
                id: 'sale-open-local',
                saleNumber: 750,
                totalUsd: 20,
                cajaCerrada: true,
                cierreId: 'cierre_test_38',
                cierreNumber: 38,
                timestamp: '2026-09-09T10:00:00.000Z',
                updatedAt: '2026-09-09T14:00:00.000Z'
            }
        ];

        const merged = mergeSalesArrays(incomingSales, localSales);

        expect(merged[0].cajaCerrada).toBe(true);
        expect(merged[0].cierreId).toBe('cierre_test_38');
        expect(merged[0].cierreNumber).toBe(38);
    });

    it('preserva REGISTRO_CIERRE intactos con su summary contable', () => {
        const localSales = [
            {
                id: 'cierre_37_doc',
                tipo: 'REGISTRO_CIERRE',
                cierreNumber: 37,
                timestamp: '2026-09-10T18:48:00.000Z',
                summary: {
                    cierreNumber: 37,
                    todayTotalBs: 18222.66,
                    todayTotalUsd: 22.22
                }
            }
        ];

        const incomingSales = [
            {
                id: 'cierre_37_doc',
                tipo: 'REGISTRO_CIERRE',
                timestamp: '2026-09-10T18:48:00.000Z',
                updatedAt: '2026-09-11T00:00:00.000Z'
            }
        ];

        const merged = mergeSalesArrays(incomingSales, localSales);

        expect(merged).toHaveLength(1);
        expect(merged[0].tipo).toBe('REGISTRO_CIERRE');
        expect(merged[0].cierreNumber).toBe(37);
        expect(merged[0].cajaCerrada).toBe(true);
        expect(merged[0].summary.todayTotalBs).toBe(18222.66);
    });

    it('detecta pérdida de cierres históricos con isCierresCountShrinking', () => {
        const existingWith40Cierres = Array.from({ length: 40 }, (_, i) => ({
            id: `cierre_${i + 1}`,
            tipo: 'REGISTRO_CIERRE'
        }));

        const incomingWith35Cierres = Array.from({ length: 35 }, (_, i) => ({
            id: `cierre_${i + 1}`,
            tipo: 'REGISTRO_CIERRE'
        }));

        const incomingWith41Cierres = Array.from({ length: 41 }, (_, i) => ({
            id: `cierre_${i + 1}`,
            tipo: 'REGISTRO_CIERRE'
        }));

        expect(isCierresCountShrinking(incomingWith35Cierres, existingWith40Cierres)).toBe(true);
        expect(isCierresCountShrinking(incomingWith41Cierres, existingWith40Cierres)).toBe(false);
        expect(isCierresCountShrinking([], existingWith40Cierres)).toBe(true);
    });
});

