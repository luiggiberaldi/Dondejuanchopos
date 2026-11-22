import { describe, expect, it } from 'vitest';
import { calculateStockAtDate, compactKardexPayload } from '../src/utils/kardexScope';
import { reconcileRemoteInventory } from '../src/utils/remoteInventoryReconciliation';

const NOW = '2026-10-01T12:00:00.000Z';
const movement = (id, date, product, stock) => ({
    id,
    producto_id: product,
    tipo: 'VENTA',
    cantidad: -1,
    stock_antes: stock + 1,
    stock_despues: stock,
    created_at: date,
    timestamp: date,
    metadata: { operationId: `op-${id}` },
});

describe('compactKardexPayload', () => {
    it('replaces only provable old movement history with one deterministic opening snapshot per SKU', () => {
        const source = [
            movement('old-p1-a', '2026-08-01T10:00:00.000Z', 'p1', 10),
            movement('old-p1-b', '2026-08-02T10:00:00.000Z', 'p1', 8),
            movement('old-p2', '2026-08-03T10:00:00.000Z', 'p2', 4),
            movement('recent-p1', '2026-09-30T10:00:00.000Z', 'p1', 7),
            { id: 'unknown-date', producto_id: 'p3', tipo: 'AJUSTE', stock_despues: 3 },
        ];
        const original = structuredClone(source);
        const compacted = compactKardexPayload(source, 30, NOW);

        expect(source).toEqual(original);
        expect(compacted).toHaveLength(4);
        expect(compacted.find(row => row.id.startsWith('kardex_period_opening_p1'))).toMatchObject({
            tipo: 'APERTURA_PERIODO', subtipo: 'EGRESS_SNAPSHOT', stock_antes: 8, stock_despues: 8,
        });
        expect(compacted.find(row => row.id.startsWith('kardex_period_opening_p2'))).toMatchObject({ stock_despues: 4 });
        expect(compacted.find(row => row.id === 'recent-p1')).toBeDefined();
        expect(compacted.find(row => row.id === 'unknown-date')).toBeDefined();
    });

    it('preserves reconstructed stock at and after the retention boundary', () => {
        const source = [
            movement('old', '2026-08-01T10:00:00.000Z', 'p1', 10),
            movement('oldest-before-cutoff', '2026-08-31T10:00:00.000Z', 'p1', 9),
            movement('recent', '2026-09-30T10:00:00.000Z', 'p1', 7),
        ];
        const compacted = compactKardexPayload(source, 30, NOW);
        expect(calculateStockAtDate(compacted, 'p1', '2026-09-30T23:59:59.000Z')).toBe(7);
        expect(calculateStockAtDate(compacted, 'p1', '2026-09-02T00:00:00.000Z')).toBe(9);
    });

    it('returns non-array input unchanged and leaves movements without numeric stock uncompressed', () => {
        expect(compactKardexPayload(null)).toBeNull();
        const source = [{ id: 'unknown', producto_id: 'p1', created_at: '2026-01-01T00:00:00.000Z' }];
        expect(compactKardexPayload(source, 30, NOW)).toEqual(source);
    });

    it('guardrail: reconcileRemoteInventory respeta APERTURA_PERIODO sin falsos positivos pre-corte pero audita estricto post-corte', () => {
        const rawKardex = [
            { ...movement('old-p1', '2026-08-10T10:00:00.000Z', 'p1', 10), referencia_id: 'sale-old', operation_id: 'op-old' },
            { ...movement('new-p1', '2026-09-29T10:00:00.000Z', 'p1', 9), referencia_id: 'sale-new', operation_id: 'op-new' },
        ];
        const compacted = compactKardexPayload(rawKardex, 30, NOW);
        const products = [{ id: 'p1', name: 'Polar', stock: 9 }];
        const sales = [
            { id: 'sale-old', tipo: 'VENTA', timestamp: '2026-08-10T10:00:00.000Z', items: [{ id: 'p1', name: 'Polar', qty: 1 }] },
            { id: 'sale-new', tipo: 'VENTA', timestamp: '2026-09-29T10:00:00.000Z', items: [{ id: 'p1', name: 'Polar', qty: 1 }] },
        ];
        const operations = [
            { operationId: 'op-old', status: 'APPLIED_LOCAL', createdAt: '2026-08-10T10:00:00.000Z', movementIds: ['old-p1'] },
            { operationId: 'op-new', status: 'APPLIED_LOCAL', createdAt: '2026-09-29T10:00:00.000Z', movementIds: ['new-p1'] },
        ];

        const okAudit = reconcileRemoteInventory({ products, sales, kardex: compacted, operations });
        expect(okAudit.status).toBe('OK');
        expect(okAudit.discrepancies).toHaveLength(0);
        expect(okAudit.warnings).toHaveLength(0);

        // Post-corte: una venta reciente SIN movimiento Kardex SÍ debe levantar advertencia
        const badAudit = reconcileRemoteInventory({
            products,
            sales: [...sales, { id: 'sale-missing', tipo: 'VENTA', timestamp: '2026-09-30T10:00:00.000Z', items: [{ id: 'p1', name: 'Polar', qty: 1 }] }],
            kardex: compacted,
            operations,
        });
        expect(badAudit.warnings.some((w) => w.code === 'SALE_WITHOUT_PHYSICAL_MOVEMENT' && w.saleId === 'sale-missing')).toBe(true);
    });
});
