import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { VALID_COMMAND_STATUSES } from '../src/constants/commandStatus';

describe('Command Status Mirror Test', () => {
    test('VALID_COMMAND_STATUSES matches PostgreSQL supervisor_commands_status_check constraint 1-to-1', () => {
        const sqlPath = path.resolve(__dirname, '../supabase_supervisor_commands_setup.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

        // Extraer los literales de la constraint supervisor_commands_status_check
        const match = sqlContent.match(/supervisor_commands_status_check[\s\S]*?CHECK\s*\(\s*status\s+IN\s*\(([^)]+)\)\s*\)/i);
        expect(match).not.toBeNull();

        const sqlStatuses = match[1]
            .split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);

        expect(sqlStatuses.sort()).toEqual([...VALID_COMMAND_STATUSES].sort());
    });

    // F3: ningún literal de status emitido por el código puede quedar fuera del
    // enum. Este test es el que habría cazado F1 ('cancelled') el primer día.
    test('no source file writes a supervisor_commands status literal outside the enum', () => {
        const roots = [
            path.resolve(__dirname, '../src/views/OwnerMonitorView.jsx'),
            path.resolve(__dirname, '../src/hooks/useSupervisorCommands.js'),
            path.resolve(__dirname, '../src/hooks/useSupervisorCommandQueue.js'),
        ];
        const emitted = new Set();
        for (const file of roots) {
            const src = fs.readFileSync(file, 'utf-8');
            for (const m of src.matchAll(/status:\s*'([a-z_]+)'/g)) emitted.add(m[1]);
            for (const m of src.matchAll(/updateCommandStatus\([^,]+,\s*'([a-z_]+)'/g)) emitted.add(m[1]);
        }
        const unknown = [...emitted].filter(s => !VALID_COMMAND_STATUSES.includes(s));
        expect(unknown).toEqual([]);
    });
});
