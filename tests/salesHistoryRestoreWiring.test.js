import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pruebas de invariantes de cableado para FASE 2 (replace_sales_history).
 * El handler vive dentro de un hook de React; seguimos el patrón
 * fuente-invariante del repo (cf. tests/shiftHistoricalCierresGuard.test.js):
 * leemos el fuente y afirmamos las propiedades de seguridad críticas.
 */
const HOOK = readFileSync(join(__dirname, '..', 'src', 'hooks', 'useSupervisorCommands.js'), 'utf8');
const MERGE = readFileSync(join(__dirname, '..', 'src', 'utils', 'salesPushMerge.js'), 'utf8');

describe('cableado replace_sales_history en useSupervisorCommands.js', () => {
    test('el branch genérico de inventario EXCLUYE replace_sales_history del enrutado', () => {
        const m = HOOK.match(/command\.payload\?\.action !== 'enable_feature' && command\.payload\?\.action !== 'replace_sales_history'/);
        expect(m, 'el discriminador debe excluir replace_sales_history para que no caiga en applyInventoryCommand').toBeTruthy();
    });

    test('existe un branch propio para replace_sales_history', () => {
        expect(HOOK).toContain("command.payload?.action === 'replace_sales_history'");
    });

    test('gate de dispositivo de producción presente', () => {
        expect(HOOK).toContain("'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F'");
        expect(HOOK).toMatch(/Dispositivo no autorizado/);
    });

    test('gate de turno activo re-verificado (prepare Y apply)', () => {
        // Al menos dos chequeos: uno antes del if de fase y otro dentro del lock de apply.
        const hits = HOOK.match(/turno activo/g) || [];
        expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    test('lectura cloud FRESCA (fresh: true) en ambas fases', () => {
        const hits = HOOK.match(/fresh: true/g) || [];
        expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    test('backup obligatorio verificado antes de prepare', () => {
        expect(HOOK).toMatch(/read_paired_cloud_backup/);
        expect(HOOK).toMatch(/sin backup reciente/);
    });

    test('solo se escribe bodega_sales_v1 (ningún otro doc ni flags de sync)', () => {
        // Extraer SOLO el bloque del handler FASE 2 y afirmar la única escritura.
        const start = HOOK.indexOf('FASE 2 del plan maestro');
        expect(start).toBeGreaterThan(0);
        const block = HOOK.slice(start);
        const writes = block.match(/storageService\.setItem\('([^']+)'/g) || [];
        expect(writes.length).toBeGreaterThan(0);
        for (const w of writes) {
            expect(w).toBe("storageService.setItem('bodega_sales_v1'");
        }
        // El bloque no debe tocar localStorage de flags (salvo lectura para el push condicional).
        expect(block).not.toMatch(/localStorage\.setItem\('dj_/);
    });

    test('apply corre bajo pos_write_lock', () => {
        expect(HOOK).toMatch(/withLock\('pos_write_lock'/);
    });

    test('push post-apply condicionado al flag de FASE 1', () => {
        expect(HOOK).toMatch(/dj_sales_push_merge_v1/);
    });
});

describe('opción fresh en fetchCloudSalesReference (salesPushMerge.js)', () => {
    test('la opción fresh existe y omite la caché TTL', () => {
        expect(MERGE).toMatch(/\{ fresh = false \}/);
        expect(MERGE).toMatch(/if \(!fresh && _refCache\.payload/);
    });
});
