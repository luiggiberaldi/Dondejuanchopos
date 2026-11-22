import { describe, test, expect } from 'vitest';
import {
    SALES_SYNC_FINGERPRINTS_KEY,
    SALES_DELTA_MAX_BATCH,
    SALES_DELTA_MAX_BYTES,
    computeSaleSyncFingerprint,
    buildSyncedFingerprintsMap,
    mergeSyncedFingerprints,
    extractSalesDelta,
} from '../src/utils/salesDeltaSync';

const makeSale = (id, overrides = {}) => ({
    id,
    tipo: 'VENTA',
    saleNumber: 1900,
    timestamp: '2026-11-22T02:00:00.000Z',
    updatedAt: '2026-11-22T02:00:00.000Z',
    totalUsd: 10,
    totalBs: 10000,
    status: 'COMPLETADA',
    cajaCerrada: false,
    items: [{ id: 'p1', name: 'Harina', qty: 2, priceUsd: 5 }],
    payments: [{ methodId: 'efectivo_bs', amountBs: 10000, amountUsd: 10 }],
    ...overrides,
});

describe('Task 2 — salesDeltaSync (helper puro + guardrails)', () => {
    test('exporta constantes canónicas y clave fuera de IDB_KEYS', () => {
        expect(SALES_SYNC_FINGERPRINTS_KEY).toBe('bodega_sales_sync_fingerprints_v1');
        expect(SALES_DELTA_MAX_BATCH).toBe(250);
        expect(SALES_DELTA_MAX_BYTES).toBeLessThanOrEqual(2 * 1024 * 1024);
    });

    test('computeSaleSyncFingerprint detecta cambios en sellado, anulación, montos, método de pago y summary de cierre', () => {
        const base = makeSale('s1');
        const fpBase = computeSaleSyncFingerprint(base);
        expect(fpBase.length).toBeGreaterThan(10);

        expect(computeSaleSyncFingerprint({ ...base, cajaCerrada: true, cierreId: 999 })).not.toBe(fpBase);
        expect(computeSaleSyncFingerprint({ ...base, status: 'ANULADA' })).not.toBe(fpBase);
        expect(computeSaleSyncFingerprint({ ...base, totalBs: 10500 })).not.toBe(fpBase);
        expect(computeSaleSyncFingerprint({
            ...base,
            payments: [{ methodId: 'pago_movil', amountBs: 10000, amountUsd: 10 }],
        })).not.toBe(fpBase);

        const cierre1 = {
            id: 'cierre_100',
            tipo: 'REGISTRO_CIERRE',
            cierreId: 100,
            cierreNumber: 100,
            timestamp: '2026-11-22T03:59:00.000Z',
            cajaCerrada: true,
            summary: { todayTotalUsd: 141.42, todayTotalBs: 143504.37 },
        };
        const cierre2 = {
            ...cierre1,
            summary: { todayTotalUsd: 150.00, todayTotalBs: 150000 },
        };
        expect(computeSaleSyncFingerprint(cierre1)).not.toBe(computeSaleSyncFingerprint(cierre2));
    });

    test('mapa cálido extrae únicamente la venta nueva o modificada (1 de 500)', () => {
        const history = Array.from({ length: 500 }, (_, i) => makeSale(`s_${i}`, {
            saleNumber: 1000 + i,
            cajaCerrada: true,
            cierreId: 50,
            timestamp: '2026-10-01T12:00:00.000Z',
        }));
        const fingerprints = buildSyncedFingerprintsMap(history);

        const newSale = makeSale('s_new', { saleNumber: 1927, timestamp: '2026-11-22T04:00:00.000Z' });
        const result = extractSalesDelta([newSale, ...history], fingerprints);

        expect(result.mode).toBe('delta');
        expect(result.records).toHaveLength(1);
        expect(result.records[0].id).toBe('s_new');
    });

    test('mapa cálido devuelve unchanged cuando ningún registro cambió', () => {
        const history = [makeSale('s1'), makeSale('s2')];
        const fingerprints = buildSyncedFingerprintsMap(history);
        const result = extractSalesDelta(history, fingerprints);

        expect(result).toEqual({ mode: 'unchanged', records: [] });
    });

    test('arranque en frío SIN expectedCierreId devuelve mode=full para sembrar huellas', () => {
        const history = [makeSale('s1'), makeSale('s2')];
        expect(extractSalesDelta(history, null)).toEqual({ mode: 'full', records: null });
        expect(extractSalesDelta(history, {})).toEqual({ mode: 'full', records: null });
    });

    test('arranque en frío CON expectedCierreId (cierre crítico) extrae fast-path solo del cierre + abiertos + últimas 72h', () => {
        const nowMs = Date.parse('2026-11-22T04:00:00.000Z');
        const oldClosed = Array.from({ length: 400 }, (_, i) => makeSale(`old_${i}`, {
            cajaCerrada: true,
            cierreId: 80,
            timestamp: '2026-09-10T15:00:00.000Z',
            updatedAt: '2026-09-10T15:00:00.000Z',
        }));
        const shiftSale1 = makeSale('shift_1', {
            cajaCerrada: true,
            cierreId: 1795320000000,
            timestamp: '2026-11-21T18:00:00.000Z',
            updatedAt: '2026-11-21T18:00:00.000Z',
        });
        const cierreRec = {
            id: 'cierre_1795320000000',
            tipo: 'REGISTRO_CIERRE',
            cierreId: 1795320000000,
            cierreNumber: 100,
            timestamp: '2026-11-22T03:59:00.000Z',
            cajaCerrada: true,
            summary: { todayTotalUsd: 10, todayTotalBs: 10000 },
        };
        const orphanOpen = makeSale('orphan_open', {
            cajaCerrada: false,
            timestamp: '2026-09-08T04:33:27.139Z',
            updatedAt: '2026-09-08T04:33:27.139Z',
        });

        const res = extractSalesDelta(
            [cierreRec, shiftSale1, orphanOpen, ...oldClosed],
            null,
            { expectedCierreId: 1795320000000, nowMs },
        );

        expect(res.mode).toBe('delta');
        expect(res.records.map(r => r.id).sort()).toEqual([
            'cierre_1795320000000',
            'orphan_open',
            'shift_1',
        ]);
    });

    test('guardrail: lote que supera maxBatch o SALES_DELTA_MAX_BYTES cae a mode=full', () => {
        const many = Array.from({ length: 260 }, (_, i) => makeSale(`m_${i}`));
        const existingFp = { existing_only: 'abc' };
        expect(extractSalesDelta(many, existingFp)).toEqual({ mode: 'full', records: null });

        const giantSale = makeSale('giant', {
            items: Array.from({ length: 3000 }, (_, i) => ({
                id: `item_${i}`,
                name: 'X'.repeat(600),
                qty: 1,
                priceUsd: 1,
            })),
        });
        expect(extractSalesDelta([giantSale], existingFp)).toEqual({ mode: 'full', records: null });
    });

    test('guardrail de cierre crítico garantiza inclusión de REGISTRO_CIERRE y sus ventas aunque el mapa de huellas esté desfasado', () => {
        const cierreId = 1795320000000;
        const closedSale = makeSale('s_closed', { cajaCerrada: true, cierreId });
        const cierreRec = {
            id: `cierre_${cierreId}`,
            tipo: 'REGISTRO_CIERRE',
            cierreId,
            cierreNumber: 100,
            timestamp: '2026-11-22T03:59:00.000Z',
            cajaCerrada: true,
        };
        // Simula caso extremo donde el mapa ya tenía la huella pero queremos confirmar cierre en nube
        const staleMap = buildSyncedFingerprintsMap([closedSale, cierreRec]);
        const res = extractSalesDelta([cierreRec, closedSale], staleMap, { expectedCierreId: cierreId });

        expect(res.mode).toBe('delta');
        expect(res.records.some(r => r.id === `cierre_${cierreId}`)).toBe(true);
        expect(res.records.some(r => r.id === 's_closed')).toBe(true);
    });

    test('mergeSyncedFingerprints actualiza solo registros confirmados y preserva el resto sin mutar el mapa previo', () => {
        const prev = { a: 'fp_a', b: 'fp_b' };
        const updated = mergeSyncedFingerprints(prev, [makeSale('b', { totalUsd: 99 }), makeSale('c')]);
        expect(prev).toEqual({ a: 'fp_a', b: 'fp_b' });
        expect(updated.a).toBe('fp_a');
        expect(updated.b).not.toBe('fp_b');
        expect(typeof updated.c).toBe('string');
    });
});
