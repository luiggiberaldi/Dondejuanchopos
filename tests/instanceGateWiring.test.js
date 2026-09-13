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

describe('auto-diferimiento nocturno de FASE 2 (sin orquestador local)', () => {
    test('prepare con turno abierto → return silencioso (queda pending)', () => {
        // El defer por turno activo vive en el Gate 2, común a ambas fases.
        const i = HOOK.indexOf('// Gate 2 (AUTO-DIFERIMIENTO)');
        expect(i).toBeGreaterThan(-1);
        const block = HOOK.slice(i, i + 500);
        expect(block).toMatch(/if \(shift\.open\) \{\s*return;/);
        expect(block).not.toMatch(/updateCommandStatus\(command\.id, 'failed'/);
    });

    test('prepare sin backup reciente → auto-encola request_full_backup y difiere', () => {
        const i = HOOK.indexOf("if (phase === 'prepare') {");
        const block = HOOK.slice(i, i + 4000);
        expect(block).toMatch(/request_full_backup/);
        expect(block).toMatch(/pre-replace-sales-history \(auto\)/);
    });

    test('prepare sella su confirmToken en su propia fila al aplicar', () => {
        const i = HOOK.indexOf("if (phase === 'prepare') {");
        const block = HOOK.slice(i, i + 4800);
        expect(block).toMatch(/confirmToken: check\.confirmToken/);
    });

    test('apply sin prepare aplicado → difiere como pending (no falla)', () => {
        const i = HOOK.indexOf('AUTO-DIFERIMIENTO: sin prepare aplicado');
        expect(i).toBeGreaterThan(-1);
        const block = HOOK.slice(i, i + 1200);
        expect(block).toContain('return; // defer: aún no hay prepare aplicado');
    });

    test('apply respeta un confirmToken externo ya verificado (modo orquestado)', () => {
        const i = HOOK.indexOf('AUTO-DIFERIMIENTO: sin prepare aplicado');
        const block = HOOK.slice(i, i + 1200);
        expect(block).toMatch(/command\.payload\?\.confirmToken/);
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

    test('lee el gate del canal supervisor_commands (sin DDL nuevo)', () => {
        expect(MOD).toContain("from('supervisor_commands')");
        expect(MOD).toContain("'instance_gate'");
    });

    test('el anuncio solo vale si está applied (jamás pending)', () => {
        expect(MOD).toMatch(/\.eq\('status', 'applied'\)/);
    });

    test('id persistente en localStorage bajo clave dedicada', () => {
        expect(MOD).toContain('dj_instance_id');
    });
});
