import { describe, test, expect } from 'vitest';
import { summarizeBackupSales, ageMinutes, computeDivergence } from '../src/utils/divergenceAlert';

const NOW = new Date('2026-09-13T03:00:00.000Z').getTime();

describe('summarizeBackupSales', () => {
    test('lee data.idb.bodega_sales_v1 (formato de backup remoto real)', () => {
        expect(summarizeBackupSales({
            data: { idb: { bodega_sales_v1: [{ tipo: 'VENTA', saleNumber: 5 }, { tipo: 'VENTA', saleNumber: 12 }] },
                    ls: {} },
        })).toEqual({ count: 2, maxSaleNumber: 12 });
    });
    test('formatos alternativos (data directa, payload.sales)', () => {
        expect(summarizeBackupSales({ data: { bodega_sales_v1: [{ saleNumber: 3 }] } })).toEqual({ count: 1, maxSaleNumber: 3 });
        expect(summarizeBackupSales({ payload: { sales: [{ saleNumber: 9 }] } })).toEqual({ count: 1, maxSaleNumber: 9 });
    });
    test('sin ventas o backup roto → nulls (no explota)', () => {
        expect(summarizeBackupSales(null)).toEqual({ count: null, maxSaleNumber: null });
        expect(summarizeBackupSales({ data: { idb: {} } })).toEqual({ count: null, maxSaleNumber: null });
        expect(summarizeBackupSales({ data: { idb: { bodega_sales_v1: [] } } })).toEqual({ count: 0, maxSaleNumber: 0 });
    });
});

describe('ageMinutes', () => {
    test('calcula minutos transcurridos', () => {
        expect(ageMinutes('2026-09-13T02:45:00.000Z', NOW)).toBe(15);
    });
    test('timestamp inválido/ausente → Infinity', () => {
        expect(ageMinutes(null, NOW)).toBe(Infinity);
        expect(ageMinutes('no-es-fecha', NOW)).toBe(Infinity);
    });
    test('timestamp futuro → 0', () => {
        expect(ageMinutes('2026-09-13T03:05:00.000Z', NOW)).toBe(0);
    });
});

describe('computeDivergence — veredictos', () => {
    const fresh = '2026-09-13T02:50:00.000Z'; // 10 min antes de NOW
    test('ok: coincide y backup fresco', () => {
        const r = computeDivergence({ cloudSalesCount: 959, pcSalesCount: 959, pcBackupAt: fresh, nowMs: NOW });
        expect(r.level).toBe('ok');
        expect(r.missing).toBe(0);
    });
    test('warn: la nube va detrás del PC (faltan registros por subir)', () => {
        const r = computeDivergence({ cloudSalesCount: 959, pcSalesCount: 962, pcBackupAt: fresh, nowMs: NOW });
        expect(r.level).toBe('warn');
        expect(r.missing).toBe(3);
        expect(r.title).toContain('3');
    });
    test('warn también cuando la nube tiene MÁS que el PC (PC truncado aún sin FASE 2)', () => {
        const r = computeDivergence({ cloudSalesCount: 959, pcSalesCount: 78, pcBackupAt: fresh, nowMs: NOW });
        expect(r.level).toBe('warn');
        expect(r.missing).toBe(881);
    });
    test('stale: backup demasiado viejo', () => {
        const r = computeDivergence({ cloudSalesCount: 959, pcSalesCount: 959, pcBackupAt: '2026-09-12T20:56:34.000Z', staleAfterMin: 30, nowMs: NOW });
        expect(r.level).toBe('stale');
    });
    test('unknown: sin backup que comparar', () => {
        const r = computeDivergence({ cloudSalesCount: 959, pcSalesCount: null, pcBackupAt: null, nowMs: NOW });
        expect(r.level).toBe('unknown');
    });
    test('edge: nube vacía (0) + PC vacío (0) y fresco → ok', () => {
        const r = computeDivergence({ cloudSalesCount: 0, pcSalesCount: 0, pcBackupAt: fresh, nowMs: NOW });
        expect(r.level).toBe('ok');
    });
});
