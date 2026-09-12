import { describe, test, expect } from 'vitest';
import {
    detectActiveShift,
    computeConfirmToken,
    validateReplacePreconditions,
} from '../src/utils/salesHistoryRestore';

const mkApertura = (id, ts) => ({ id, tipo: 'APERTURA_CAJA', timestamp: ts });
const mkCierre = (id, ts, cierreNumber) => ({ id, tipo: 'REGISTRO_CIERRE', timestamp: ts, cierreNumber });
const mkVenta = (id, saleNumber, ts) => ({ id, tipo: 'VENTA', saleNumber, timestamp: ts, totalBs: 100 });

describe('detectActiveShift', () => {
    test('sin registros → no abierto', () => {
        expect(detectActiveShift([]).open).toBe(false);
        expect(detectActiveShift(null).open).toBe(false);
    });

    test('apertura sin cierre posterior → turno ABIERTO', () => {
        const sales = [
            mkCierre('c1', '2026-09-12T04:30:00Z', 3),
            mkApertura('a2', '2026-09-12T16:16:00Z'),
        ];
        const r = detectActiveShift(sales);
        expect(r.open).toBe(true);
        expect(r.aperturaId).toBe('a2');
    });

    test('cierre posterior a la última apertura → turno CERRADO', () => {
        const sales = [
            mkApertura('a1', '2026-09-12T16:16:00Z'),
            mkCierre('c2', '2026-09-12T23:00:00Z', 4),
        ];
        expect(detectActiveShift(sales).open).toBe(false);
    });

    test('solo cierres históricos (sin aperturas) → no abierto', () => {
        expect(detectActiveShift([mkCierre('c1', '2026-09-01T10:00:00Z', 1)]).open).toBe(false);
    });
});

describe('computeConfirmToken', () => {
    test('formato cierreCount:maxSaleNumber:recordCount', () => {
        const sales = [
            mkCierre('c1', '2026-09-12T04:30:00Z', 3),
            mkCierre('c2', '2026-09-11T04:30:00Z', 2),
            mkVenta('v1', 815, '2026-09-12T03:00:00Z'),
            mkVenta('v2', 817, '2026-09-12T03:10:00Z'),
            mkApertura('a1', '2026-09-12T16:16:00Z'),
        ];
        expect(computeConfirmToken(sales)).toBe('2:817:5');
    });

    test('array vacío → 0:0:0', () => {
        expect(computeConfirmToken([])).toBe('0:0:0');
    });
});

describe('validateReplacePreconditions', () => {
    const cloudOk = [
        mkCierre('c1', '2026-09-12T04:30:00Z', 3),
        mkVenta('v1', 817, '2026-09-12T03:00:00Z'),
    ];

    test('referencia cloud vacía/ilegible → rechaza', () => {
        expect(validateReplacePreconditions([], null).ok).toBe(false);
        expect(validateReplacePreconditions([], []).ok).toBe(false);
    });

    test('cloud sin cierres → rechaza (doc sospechoso)', () => {
        const r = validateReplacePreconditions([], [mkVenta('v1', 1, '2026-09-12T03:00:00Z')]);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/cierres/);
    });

    test('token incorrecto → rechaza y devuelve el token real', () => {
        const r = validateReplacePreconditions([], cloudOk, '43:815:940');
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/token no coincide/);
        expect(r.confirmToken).toBe('1:817:2');
    });

    test('token correcto → acepta', () => {
        const r = validateReplacePreconditions([], cloudOk, '1:817:2');
        expect(r.ok).toBe(true);
    });

    test('regresión de numeración (max local > max cloud) → rechaza', () => {
        const local = [mkVenta('vL', 900, '2026-09-12T10:00:00Z')];
        const r = validateReplacePreconditions(local, cloudOk, null);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/regresión de numeración/);
    });

    test('turno activo local → rechaza', () => {
        const local = [
            mkCierre('c1', '2026-09-12T04:30:00Z', 3),
            mkApertura('a2', '2026-09-12T16:16:00Z'),
        ];
        const r = validateReplacePreconditions(local, cloudOk, null);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/turno activo/);
    });

    test('historial local truncado (max menor) + caja cerrada → happy path', () => {
        const local = [mkVenta('vL', 815, '2026-09-12T04:24:00Z')];
        const r = validateReplacePreconditions(local, cloudOk, null);
        expect(r.ok).toBe(true);
        expect(r.confirmToken).toBe('1:817:2');
    });
});
