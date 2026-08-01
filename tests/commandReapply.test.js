import { describe, test, expect } from 'vitest';
import { isReappliableCommand } from '../src/utils/remoteInventoryProcessor';

describe('isReappliableCommand safety checks', () => {
    test('batch_edit is reappliable (idempotent overwrite)', () => {
        expect(isReappliableCommand({ action: 'batch_edit' })).toBe(true);
    });

    test('adjust_stock with targetStock is reappliable (absolute value)', () => {
        expect(isReappliableCommand({ action: 'adjust_stock', data: { targetStock: 50 } })).toBe(true);
        expect(isReappliableCommand({ action: 'adjust_stock', data: { targetStock: 0 } })).toBe(true);
    });

    test('adjust_stock with delta is NOT reappliable (additive stock duplication risk)', () => {
        expect(isReappliableCommand({ action: 'adjust_stock', data: { delta: 5 } })).toBe(false);
        expect(isReappliableCommand({ action: 'adjust_stock', data: { delta: -2 } })).toBe(false);
    });

    test('add, edit, delete actions are NOT reappliable', () => {
        expect(isReappliableCommand({ action: 'add', data: { name: 'Prod' } })).toBe(false);
        expect(isReappliableCommand({ action: 'edit', data: { name: 'Prod' } })).toBe(false);
        expect(isReappliableCommand({ action: 'delete' })).toBe(false);
    });

    test('null or undefined payloads return false safely', () => {
        expect(isReappliableCommand(null)).toBe(false);
        expect(isReappliableCommand(undefined)).toBe(false);
        expect(isReappliableCommand({})).toBe(false);
    });
});
