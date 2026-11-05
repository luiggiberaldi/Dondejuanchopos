import { describe, expect, it } from 'vitest';
import { continuesGroup, INTERCOM_PALETTE, senderColor, senderInitials } from '../src/utils/intercomIdentity';

describe('senderColor', () => {
    it('is stable for the same device and independent of the name', () => {
        expect(senderColor('mon_j3mewwp8q6_mtdn9jyo').key).toBe(senderColor('mon_j3mewwp8q6_mtdn9jyo').key);
    });
    it('returns a palette color', () => {
        const { key, color } = senderColor('PDA-V2-ED46');
        expect(INTERCOM_PALETTE.find(item => item.key === key).color).toBe(color);
    });
    it('spreads different devices over several colors', () => {
        const keys = new Set(Array.from({ length: 40 }, (_, i) => senderColor(`mon_device_${i}`).key));
        expect(keys.size).toBeGreaterThan(4);
    });
});

describe('senderInitials', () => {
    it('builds initials from names', () => {
        expect(senderInitials('Luis Medina')).toBe('LM');
        expect(senderInitials('Kelman')).toBe('KE');
        expect(senderInitials('  ana  maria  lopez ')).toBe('AL');
        expect(senderInitials('')).toBe('?');
    });
});

describe('continuesGroup', () => {
    const base = { sender_device_id: 'a', created_at: '2026-11-05T19:00:00Z' };
    it('groups the same sender within 5 minutes', () => {
        expect(continuesGroup(base, { sender_device_id: 'a', created_at: '2026-11-05T19:04:59Z' })).toBe(true);
    });
    it('breaks the group on another sender or after 5 minutes', () => {
        expect(continuesGroup(base, { sender_device_id: 'b', created_at: '2026-11-05T19:01:00Z' })).toBe(false);
        expect(continuesGroup(base, { sender_device_id: 'a', created_at: '2026-11-05T19:06:00Z' })).toBe(false);
        expect(continuesGroup(undefined, base)).toBe(false);
    });
});
