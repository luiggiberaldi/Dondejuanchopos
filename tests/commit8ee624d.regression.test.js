import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { VALID_COMMAND_STATUSES } from '../src/constants/commandStatus';
import { PRICING_MODES, FROZEN_MODES } from '../src/constants/pricingModes';
import { normalizeProduct } from '../src/utils/productProcessor';
import { getFrozenFormats } from '../src/utils/frozenPrices';

describe('Regression Harness: Invariants from Commit 8ee624d Fix Plan', () => {
    test('Invariant 1: SQL supervisor_commands_status_check matches VALID_COMMAND_STATUSES 1-to-1', () => {
        const sqlPath = path.resolve(__dirname, '../supabase_supervisor_commands_setup.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

        const match = sqlContent.match(/supervisor_commands_status_check[\s\S]*?CHECK\s*\(\s*status\s+IN\s*\(([^)]+)\)\s*\)/i);
        expect(match).not.toBeNull();

        const sqlStatuses = match[1]
            .split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);

        expect(sqlStatuses.sort()).toEqual([...VALID_COMMAND_STATUSES].sort());
    });

    test('Invariant 2: SQL supervisor_commands_command_type_check includes all handled command types', () => {
        const sqlPath = path.resolve(__dirname, '../supabase_supervisor_commands_setup.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

        const match = sqlContent.match(/supervisor_commands_command_type_check[\s\S]*?CHECK\s*\(\s*command_type\s+IN\s*\(([^)]+)\)\s*\)/i);
        expect(match).not.toBeNull();

        const sqlTypes = match[1]
            .split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);

        expect(sqlTypes).toContain('rate_change');
        expect(sqlTypes).toContain('inventory_update');
        expect(sqlTypes).toContain('void_sale');
        expect(sqlTypes).toContain('user_update');
        expect(sqlTypes).toContain('force_daily_close');
    });

    test('Invariant 3: Product schema uses sellByBox/sellByHalfBox (never hasBox/hasHalfBox)', () => {
        const prod = normalizeProduct({
            id: 'p1',
            name: 'Producto Test',
            sellByBox: true,
            boxUnits: 12,
            sellByHalfBox: true,
            halfBoxUnits: 6
        });

        expect(prod.sellByBox).toBe(true);
        expect(prod.sellByHalfBox).toBe(true);
        expect(prod.hasBox).toBeUndefined();
        expect(prod.hasHalfBox).toBeUndefined();
    });

    test('Invariant 4: getFrozenFormats correctly identifies frozen formats with sellByBox & sellByHalfBox', () => {
        const prod = normalizeProduct({
            id: 'p1',
            name: 'Producto Congelado',
            pricingMode: 'bs_fijo',
            priceBsManual: 50,
            sellByBox: true,
            boxPricingMode: 'bs_fijo',
            boxPriceBsManual: 500,
            sellByHalfBox: true,
            halfBoxPricingMode: 'bs_fijo',
            halfBoxPriceBsManual: 250
        });

        const formats = getFrozenFormats(prod);
        expect(formats).toHaveLength(3);
        expect(formats.map(f => f.type)).toEqual(['unidad', 'caja', 'medioBulto']);
    });

    test('Invariant 5: PRICING_MODES and FROZEN_MODES consistency', () => {
        expect(PRICING_MODES).toEqual(['tasa_dia', 'bcv', 'dual_usd', 'bs_fijo']);
        expect(FROZEN_MODES).toEqual(['bs_fijo']);
        expect(PRICING_MODES).toContain(FROZEN_MODES[0]);
    });
});
