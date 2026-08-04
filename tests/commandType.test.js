import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { VALID_COMMAND_TYPES } from '../src/constants/commandType';

describe('Command Type Mirror Test', () => {
    test('VALID_COMMAND_TYPES matches PostgreSQL supervisor_commands_command_type_check constraint 1-to-1', () => {
        const sqlPath = path.resolve(__dirname, '../supabase_supervisor_commands_setup.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf-8');

        const match = sqlContent.match(/supervisor_commands_command_type_check[\s\S]*?CHECK\s*\(\s*command_type\s+IN\s*\(([^)]+)\)\s*\)/i);
        expect(match).not.toBeNull();

        const sqlTypes = match[1]
            .split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean);

        expect(sqlTypes.sort()).toEqual([...VALID_COMMAND_TYPES].sort());
    });
});
