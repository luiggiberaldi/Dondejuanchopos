import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const DELTA_SQL_PATH = path.join(ROOT, 'supabase_sales_delta_and_timeouts_setup.sql');
const AUDIT_SQL_PATH = path.join(ROOT, 'supabase_remote_audit_setup.sql');

describe('Task 1 — Contrato SQL de timeouts (30s) y RPC delta de ventas', () => {
    test('existe supabase_sales_delta_and_timeouts_setup.sql con timeouts de 30s en RPCs pesados', () => {
        expect(fs.existsSync(DELTA_SQL_PATH)).toBe(true);
        const sql = fs.readFileSync(DELTA_SQL_PATH, 'utf8');

        expect(sql).toMatch(/ALTER FUNCTION public\.read_paired_audit_documents[\s\S]*?SET statement_timeout = '30s'/i);
        expect(sql).toMatch(/ALTER FUNCTION public\.write_paired_sync_document[\s\S]*?SET statement_timeout = '30s'/i);
        expect(sql).toMatch(/ALTER FUNCTION public\.write_paired_cloud_backup[\s\S]*?SET statement_timeout = '30s'/i);
        expect(sql).toMatch(/ALTER FUNCTION public\.read_paired_cloud_backup[\s\S]*?SET statement_timeout = '30s'/i);
    });

    test('upsert_paired_sales_delta usa SECURITY DEFINER, search_path, statement_timeout 30s, FOR UPDATE y permisos mínimos', () => {
        const sql = fs.readFileSync(DELTA_SQL_PATH, 'utf8');
        const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.upsert_paired_sales_delta');
        expect(fnStart).toBeGreaterThan(-1);
        const fnBody = sql.slice(fnStart);

        expect(fnBody).toMatch(/SECURITY DEFINER/i);
        expect(fnBody).toMatch(/SET search_path = public/i);
        expect(fnBody).toMatch(/SET statement_timeout = '30s'/i);
        expect(fnBody).toMatch(/FOR UPDATE/i);
        expect(fnBody).toContain('POS_SYNC_DEVICE_NOT_REGISTERED');
        expect(fnBody).toContain('POS_SYNC_SCOPE_REQUIRED');
        expect(fnBody).toContain('POS_SYNC_DELTA_BATCH_TOO_LARGE');
        expect(fnBody).toContain('POS_SYNC_DELTA_SHRINK_BLOCKED');
        expect(fnBody).toContain('POS_SYNC_DELTA_CIERRES_SHRINK_BLOCKED');
        expect(fnBody).toContain("base_doc_missing");
        expect(fnBody).toMatch(/REVOKE ALL ON FUNCTION public\.upsert_paired_sales_delta\(TEXT, JSONB\) FROM PUBLIC/i);
        expect(fnBody).toMatch(/GRANT EXECUTE ON FUNCTION public\.upsert_paired_sales_delta\(TEXT, JSONB\) TO anon, authenticated/i);
        expect(fnBody).toMatch(/REVOKE ALL ON FUNCTION public\.merge_single_sale_jsonb\(JSONB, JSONB\) FROM PUBLIC/i);
    });

    test('merge_single_sale_jsonb protege las 5 Reglas de Oro sin casts boolean inseguros', () => {
        const sql = fs.readFileSync(DELTA_SQL_PATH, 'utf8');
        const fnStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.merge_single_sale_jsonb');
        const fnEnd = sql.indexOf('CREATE OR REPLACE FUNCTION public.upsert_paired_sales_delta');
        expect(fnStart).toBeGreaterThan(-1);
        expect(fnEnd).toBeGreaterThan(fnStart);
        const fnBody = sql.slice(fnStart, fnEnd);

        // Guardrail: nunca castear texto JSONB arbitrario con ::boolean en SQL ejecutable
        const executableSql = fnBody.replace(/--.*$/gm, '');
        expect(executableSql).not.toMatch(/::boolean/i);
        // Las 5 Reglas de Oro + Invariante I5
        expect(fnBody).toContain('REGISTRO_CIERRE');
        expect(fnBody).toContain('cajaCerrada');
        expect(fnBody).toContain('cierreId');
        expect(fnBody).toContain('ANULADA');
        expect(fnBody).toContain('inventoryDeductionsApplied');
        expect(fnBody).toContain('checkoutOperationId');
        expect(fnBody).toContain('inventoryOperationId');
    });

    test('supabase_remote_audit_setup.sql canónico mantiene SET statement_timeout = 30s en los 4 RPCs pesados', () => {
        const sql = fs.readFileSync(AUDIT_SQL_PATH, 'utf8');
        const matches = [...sql.matchAll(/SET statement_timeout = '30s'/g)];
        expect(matches.length).toBeGreaterThanOrEqual(4);
    });
});
