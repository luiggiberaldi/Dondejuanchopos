import { describe, it, expect } from 'vitest';
import {
    SALES_DELTA_KEY_PREFIX,
    salesDayString,
    salesDeltaKeyForDate,
    isSalesDeltaKey,
    salesDeltaKeysForLastNDays,
    saleTimeMs,
    filterTicketsForDay,
    buildSalesDeltaPayload,
    isValidSalesDelta,
    salesDeltaTickets,
} from '../src/utils/salesDelta';

const T = (iso) => new Date(iso).getTime();
const sale = (id, iso) => ({ id, createdAt: iso, totalUsd: 1 });

describe('salesDelta.js — Fase 2 egress', () => {
    it('salesDayString devuelve YYYY-MM-DD local', () => {
        expect(salesDayString(new Date(2026, 9, 2, 15, 30))).toBe('2026-10-02');
        expect(salesDayString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('salesDeltaKeyForDate e isSalesDeltaKey', () => {
        expect(salesDeltaKeyForDate('2026-10-02')).toBe(`${SALES_DELTA_KEY_PREFIX}2026-10-02`);
        expect(isSalesDeltaKey('bodega_sales_delta_2026-10-02')).toBe(true);
        expect(isSalesDeltaKey('bodega_sales_v1')).toBe(false);
        expect(isSalesDeltaKey('bodega_sales_delta_ayer')).toBe(false);
        expect(isSalesDeltaKey(null)).toBe(false);
    });

    it('salesDeltaKeysForLastNDays devuelve n keys, hoy primero', () => {
        const keys = salesDeltaKeysForLastNDays(7);
        expect(keys).toHaveLength(7);
        expect(keys[0]).toBe(salesDeltaKeyForDate(salesDayString()));
        expect(new Set(keys).size).toBe(7);
    });

    it('filterTicketsForDay filtra por día local de createdAt', () => {
        const tickets = [
            sale('a', '2026-10-02T10:00:00.000Z'),
            sale('b', '2026-10-01T23:30:00.000Z'),
            sale('c', '2026-10-02T23:59:00.000Z'),
        ];
        // Ojo: filtro por día LOCAL del dispositivo, no UTC.
        const day = salesDayString(new Date('2026-10-02T12:00:00.000Z'));
        const out = filterTicketsForDay(tickets, day);
        expect(out.map((t) => t.id).sort()).toEqual(
            tickets.filter((t) => salesDayString(new Date(t.createdAt)) === day).map((t) => t.id).sort()
        );
    });

    it('filterTicketsForDay acepta timestamp/fecha como fallback', () => {
        const tickets = [{ id: 'x', timestamp: '2026-10-02T08:00:00.000Z' }];
        const day = salesDayString(new Date('2026-10-02T12:00:00.000Z'));
        expect(filterTicketsForDay(tickets, day)).toHaveLength(1);
        expect(filterTicketsForDay([{ id: 'y' }], day)).toHaveLength(0);
    });

    it('buildSalesDeltaPayload arma { date, tickets } solo del día', () => {
        const day = salesDayString(new Date('2026-10-02T12:00:00.000Z'));
        const tickets = [
            sale('a', '2026-10-02T10:00:00.000Z'),
            sale('b', '2026-09-20T10:00:00.000Z'),
        ];
        const payload = buildSalesDeltaPayload(tickets, day);
        expect(payload.date).toBe(day);
        expect(payload.tickets.every((t) => salesDayString(new Date(t.createdAt)) === day)).toBe(true);
        expect(isValidSalesDelta(payload)).toBe(true);
    });

    it('isValidSalesDelta rechaza formas inválidas', () => {
        expect(isValidSalesDelta(null)).toBe(false);
        expect(isValidSalesDelta([])).toBe(false);
        expect(isValidSalesDelta({ date: 'ayer', tickets: [] })).toBe(false);
        expect(isValidSalesDelta({ date: '2026-10-02' })).toBe(false);
    });

    it('salesDeltaTickets acepta payload nuevo y array legacy', () => {
        const tickets = [sale('a', '2026-10-02T10:00:00.000Z')];
        expect(salesDeltaTickets({ date: '2026-10-02', tickets })).toEqual(tickets);
        expect(salesDeltaTickets(tickets)).toEqual(tickets);
        expect(salesDeltaTickets(null)).toEqual([]);
    });

    it('saleTimeMs prefiere createdAt y tolera ausencias', () => {
        expect(saleTimeMs(sale('a', '2026-10-02T10:00:00.000Z'))).toBe(T('2026-10-02T10:00:00.000Z'));
        expect(saleTimeMs({})).toBe(0);
    });
});
