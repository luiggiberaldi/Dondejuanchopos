import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Invariantes de cableado FASE 3A en useSupervisorCommands.js y
 * remoteAuditService.js (patrón fuente-invariante del repo).
 */
const HOOK = readFileSync(join(__dirname, '..', 'src', 'hooks', 'useSupervisorCommands.js'), 'utf8');
const AUDIT = readFileSync(join(__dirname, '..', 'src', 'services', 'remoteAuditService.js'), 'utf8');

describe('gate de instancia en processCommand', () => {
    test('el gate corre ANTES de cualquier rama de comando', () => {
        const start = HOOK.indexOf('const processCommand = async (command) => {');
        const block = HOOK.slice(start, start + 2200);
        const gateIdx = block.indexOf('canProcessCommands');
        const firstBranch = block.indexOf("command.command_type === 'request_full_backup'");
        expect(gateIdx).toBeGreaterThan(-1);
        expect(firstBranch).toBeGreaterThan(gateIdx);
    });

    test('bloqueado → return SIN updateCommandStatus (no consume el comando)', () => {
        const start = HOOK.indexOf('if (!decision.allowed) {');
        expect(start).toBeGreaterThan(-1);
        const block = HOOK.slice(start, start + 400);
        expect(block).toMatch(/console\.warn/);
        expect(block).toMatch(/return;/);
        expect(block).not.toMatch(/updateCommandStatus/);
    });

    test('fallo del gate → fail-open explícito (no bloquea la caja real)', () => {
        expect(HOOK).toMatch(/Gate de instancia no disponible \(fail-open\)/);
    });

    test('usa la utilidad de FASE 3A con import dinámico (sin coste de arranque)', () => {
        expect(HOOK).toMatch(/await import\('\.\.\/utils\/instanceFingerprint'\)/);
    });
});

describe('firma de identidad en backups', () => {
    test('buildLocalRemoteBackup recibe identidad de instancia en el handler', () => {
        expect(HOOK).toMatch(/getInstanceId\(\), hasServiceWorker\(\)/);
    });

    test('el backup incluye instanceId e instanceHasServiceWorker', () => {
        expect(AUDIT).toMatch(/instanceId: instanceId \|\| null/);
        expect(AUDIT).toMatch(/instanceHasServiceWorker: hasSW/);
    });
});

describe('módulo instanceFingerprint', () => {
    const MOD = readFileSync(join(__dirname, '..', 'src', 'utils', 'instanceFingerprint.js'), 'utf8');

    test('usa el RPC de lectura existente (sin DDL nuevo)', () => {
        expect(MOD).toContain('read_paired_audit_documents');
    });

    test('doc de gate dedicado (no toca docs de negocio)', () => {
        expect(MOD).toContain('bodega_instance_gate_v1');
    });

    test('id persistente en localStorage bajo clave dedicada', () => {
        expect(MOD).toContain('dj_instance_id');
    });
});
