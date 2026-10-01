import { describe, expect, it } from 'vitest';
import { calculateStockAtDate, compactKardexPayload } from '../src/utils/kardexScope';

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
});
