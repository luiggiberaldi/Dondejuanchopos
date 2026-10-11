import { describe, expect, it } from 'vitest';
import {
    countCodePoints,
    getCatchupFilter,
    getInitialCursor,
    getUnreadCount,
    mergeMessages,
    validateMessage,
} from '../src/utils/intercomModel';

const message = (id, created_at, sender_device_id = 'monitor-1') => ({ id, created_at, sender_device_id });

describe('intercom text and message model', () => {
    it('normalizes blank messages and counts Unicode code points', () => {
        expect(validateMessage('  \n ')).toEqual({ valid: false, reason: 'Escribe un mensaje.' });
        expect(countCodePoints('á🙂')).toBe(2);
        expect(validateMessage(`${'a'.repeat(159)}🙂`).valid).toBe(true);
        expect(validateMessage(`${'a'.repeat(160)}🙂`).valid).toBe(false);
    });

    it('trims whitespace and normalizes newlines while preserving plain text', () => {
        expect(validateMessage('  hola\r\nmundo  ').message).toBe('hola\nmundo');
    });

    it('orders by server timestamp and ID and de-duplicates realtime/fetch overlap', () => {
        const rows = mergeMessages(
            [message('b', '2026-10-10T10:00:00.000Z'), message('a', '2026-10-10T10:00:00.000Z')],
            [message('a', '2026-10-10T10:00:00.000Z'), message('c', '2026-10-10T10:01:00.000Z')],
        );
        expect(rows.map(row => row.id)).toEqual(['a', 'b', 'c']);
    });

    it('keeps read cursors separate by reader and creates lexicographic catch-up filter', () => {
        const rows = [message('1', '2026-10-10T10:00:00.000Z', 'pos'), message('2', '2026-10-10T10:00:00.000Z', 'monitor-2'), message('3', '2026-10-10T10:01:00.000Z', 'monitor-1')];
        const cursor = getInitialCursor(rows.slice(0, 1));
        expect(getUnreadCount(rows, 'monitor-1', cursor)).toBe(1);
        expect(getUnreadCount(rows, 'monitor-2', cursor)).toBe(1);
        expect(getCatchupFilter(cursor)).toBe('created_at.gt.2026-10-10T10:00:00.000Z,and(created_at.eq.2026-10-10T10:00:00.000Z,id.gt.1)');
    });
});
