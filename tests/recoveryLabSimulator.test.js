import { describe, expect, it, vi } from 'vitest';
import {
    RECOVERY_LAB_SCENARIOS,
    RECOVERY_LAB_MAX_BACKUP_AGE_MINUTES,
    runRecoveryLabSuite,
    simulateRecoveryScenario,
} from '../src/testing/recoveryLabSimulator';
import { PRIMARY_POS_DEVICE_ID } from '../src/config/tenant';

describe('Laboratorio aislado de failover', () => {
    it('solo usa escenarios sintéticos y no hace llamadas de red ni toca almacenamiento', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
        const result = simulateRecoveryScenario('recover-empty-pos');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(localStorageSpy).not.toHaveBeenCalled();
        expect(result.policy).toMatchObject({
            networkRequestsPerformed: 0,
            localWritesPerformed: 0,
            cloudWritesPerformed: 0,
        });
        fetchSpy.mockRestore();
        localStorageSpy.mockRestore();
    });

    it('contiene fixtures representativos sin leerlos de la app', () => {
        expect(RECOVERY_LAB_SCENARIOS.length).toBeGreaterThanOrEqual(10);
        expect(RECOVERY_LAB_SCENARIOS.find(scenario => scenario.id === 'recover-empty-pos').deviceId)
            .toBe(PRIMARY_POS_DEVICE_ID);
        expect(() => simulateRecoveryScenario('unknown-scenario')).toThrow(RangeError);
    });

    it('simula recuperación solo para el ID principal y solo con copia reciente válida', () => {
        const result = simulateRecoveryScenario('recover-empty-pos');
        expect(result.verdict).toBe('recovered');
        expect(result.backupAgeMinutes).toBeLessThanOrEqual(RECOVERY_LAB_MAX_BACKUP_AGE_MINUTES);
        expect(result.policy).toMatchObject({
            recoveryOnlyForPrimary: true,
            detectedIdentity: PRIMARY_POS_DEVICE_ID,
            blockCloudPublish: false,
            networkRequestsPerformed: 0,
        });
        expect(result.steps.map(step => step.label)).toContain('Aplicar y verificar');
    });

    it.each([
        ['read-failure', 'protected-read-error'],
        ['cloud-unavailable', 'protected-cloud-error'],
        ['backup-too-old', 'approval-required'],
        ['backup-incomplete', 'protected-invalid-backup'],
        ['no-backup', 'protected-no-backup'],
        ['identity-missing', 'identity-unverified'],
        ['other-device', 'identity-unverified'],
        ['fresh-install', 'fresh-install'],
        ['intentional-delete', 'intentional-empty'],
        ['import-in-progress', 'deferred-import'],
        ['restore-interrupted', 'restore-aborted'],
        ['supervisor-monitor', 'not-applicable'],
    ])('escenario %s da decisión segura %s', (scenarioId, expectedVerdict) => {
        const result = simulateRecoveryScenario(scenarioId);
        expect(result.verdict).toBe(expectedVerdict);
        expect(result.policy.networkRequestsPerformed).toBe(0);
        expect(result.policy.localWritesPerformed).toBe(0);
        expect(result.policy.cloudWritesPerformed).toBe(0);
        if (!['intentional-empty', 'local-data-present', 'fresh-install', 'not-applicable', 'recovered'].includes(expectedVerdict)) {
            expect(result.policy.blockCloudPublish).toBe(true);
        }
    });

    it('el resultado es repetible para las mismas entradas', () => {
        expect(simulateRecoveryScenario('recover-empty-pos')).toEqual(simulateRecoveryScenario('recover-empty-pos'));
    });

    it('ejecuta toda la matriz y agrega un reporte seguro y consistente', () => {
        const report = runRecoveryLabSuite();
        expect(report.total).toBe(RECOVERY_LAB_SCENARIOS.length);
        expect(report.evaluations).toHaveLength(report.total);
        expect(report.recovered).toBe(1);
        expect(report.safety).toEqual({
            noNetworkRequests: true,
            noLocalWrites: true,
            noCloudWrites: true,
        });
        expect(report.verdictCounts.recovered).toBe(1);
        expect(report.evaluations.map(item => item.scenarioId)).toEqual(RECOVERY_LAB_SCENARIOS.map(item => item.id));
    });
});
