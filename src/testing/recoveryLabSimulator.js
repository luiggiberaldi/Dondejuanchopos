import { PRIMARY_POS_DEVICE_ID } from '../config/tenant';

export const RECOVERY_LAB_MAX_BACKUP_AGE_MINUTES = 60;

const EMPTY_COUNTS = Object.freeze({ products: 0, sales: 0, customers: 0, accounts: 0 });
const GOOD_BACKUP_COUNTS = Object.freeze({ products: 126, sales: 842, customers: 74, accounts: 12 });
const EMPTY_LOCAL = Object.freeze({ read: 'ok', counts: EMPTY_COUNTS, hasPriorDataEvidence: true });
const GOOD_BACKUP = Object.freeze({
    status: 'present',
    ageMinutes: 9,
    complete: true,
    integrityValid: true,
    counts: GOOD_BACKUP_COUNTS,
});

/**
 * Fixtures are synthetic. They are deliberately not read from browser storage,
 * the network, the application stores, or any Supabase client.
 */
export const RECOVERY_LAB_SCENARIOS = Object.freeze([
    Object.freeze({
        id: 'healthy-pos',
        label: 'Caja principal con datos normales',
        description: 'El catálogo, las ventas y el resto de los conjuntos tienen registros.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        local: Object.freeze({ read: 'ok', counts: GOOD_BACKUP_COUNTS, hasPriorDataEvidence: true }),
        backup: GOOD_BACKUP,
    }),
    Object.freeze({
        id: 'recover-empty-pos',
        label: 'Caja principal en cero + copia reciente válida',
        description: 'Simula la anomalía reportada y una copia cloud completa de hace 9 minutos.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        local: EMPTY_LOCAL,
        backup: GOOD_BACKUP,
    }),
    Object.freeze({
        id: 'read-failure',
        label: 'Fallo al leer IndexedDB',
        description: 'Las lecturas no son confiables: el sistema debe protegerse, no asumir cero.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        local: Object.freeze({ read: 'error', counts: EMPTY_COUNTS, hasPriorDataEvidence: true }),
        backup: GOOD_BACKUP,
    }),
    Object.freeze({
        id: 'cloud-unavailable',
        label: 'Cloud no responde',
        description: 'La caja parece vacía, pero no se puede verificar la copia remota.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        local: EMPTY_LOCAL,
        backup: Object.freeze({ status: 'error', error: 'Error de conexión simulado' }),
    }),
    Object.freeze({
        id: 'backup-too-old',
        label: 'Copia antigua',
        description: 'La copia tiene 180 minutos; requiere revisión y no se restaura sola.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        local: EMPTY_LOCAL,
        backup: Object.freeze({ ...GOOD_BACKUP, ageMinutes: 180 }),
    }),
    Object.freeze({
        id: 'backup-incomplete',
        label: 'Copia incompleta o dañada',
        description: 'La validación falla; nunca se aplica parcialmente ni se publica el cero.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        local: EMPTY_LOCAL,
        backup: Object.freeze({ ...GOOD_BACKUP, complete: false, integrityValid: false }),
    }),
    Object.freeze({
        id: 'no-backup',
        label: 'No existe copia cloud',
        description: 'Sin una copia recuperable, se mantiene la caja protegida.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        local: EMPTY_LOCAL,
        backup: Object.freeze({ status: 'missing' }),
    }),
    Object.freeze({
        id: 'fresh-install',
        label: 'Instalación nueva intencionalmente vacía',
        description: 'Sin evidencia de datos anteriores y marcada como instalación nueva.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        freshInstall: true,
        local: Object.freeze({ read: 'ok', counts: EMPTY_COUNTS, hasPriorDataEvidence: false }),
        backup: Object.freeze({ status: 'missing' }),
    }),
    Object.freeze({
        id: 'intentional-delete',
        label: 'Borrado intencional confirmado',
        description: 'Un vaciado explícitamente confirmado no debe disparar la restauración automática.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        intentionalEmptyConfirmed: true,
        local: Object.freeze({ read: 'ok', counts: EMPTY_COUNTS, hasPriorDataEvidence: true }),
        backup: GOOD_BACKUP,
    }),
    Object.freeze({
        id: 'import-in-progress',
        label: 'Importación todavía en curso',
        description: 'El detector espera a que termine una importación antes de clasificar el estado.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        importInProgress: true,
        local: EMPTY_LOCAL,
        backup: GOOD_BACKUP,
    }),
    Object.freeze({
        id: 'restore-interrupted',
        label: 'Interrupción durante la restauración',
        description: 'Simula un fallo antes del commit: conserva el estado sospechoso y bloquea subidas.',
        deviceId: PRIMARY_POS_DEVICE_ID,
        mode: 'pos',
        failDuringRestore: true,
        local: EMPTY_LOCAL,
        backup: GOOD_BACKUP,
    }),
    Object.freeze({
        id: 'other-device',
        label: 'Otro dispositivo POS',
        description: 'El failover exclusivo de la caja principal no se aplica a otra identidad.',
        deviceId: 'fixture-secondary-pos',
        mode: 'pos',
        local: EMPTY_LOCAL,
        backup: GOOD_BACKUP,
    }),
    Object.freeze({
        id: 'identity-missing',
        label: 'Identidad ausente o regenerada',
        description: 'Si el ID documentado no se puede validar, no se adivina ni se restaura.',
        deviceId: null,
        mode: 'pos',
        local: EMPTY_LOCAL,
        backup: GOOD_BACKUP,
    }),
    Object.freeze({
        id: 'supervisor-monitor',
        label: 'Dispositivo Supervisor/monitor',
        description: 'El monitor queda fuera del failover de la caja y sus datos no se tocan.',
        deviceId: 'fixture-monitor-device',
        mode: 'monitor',
        local: EMPTY_LOCAL,
        backup: GOOD_BACKUP,
    }),
]);

function makeStep(label, status, detail) {
    return { label, status, detail };
}

function isAllCriticalDataEmpty(counts) {
    return ['products', 'sales', 'customers', 'accounts']
        .every(key => Number(counts?.[key]) === 0);
}

function countsAreUseful(counts) {
    return ['products', 'sales', 'customers', 'accounts']
        .every(key => Number.isFinite(Number(counts?.[key])) && Number(counts[key]) >= 0)
        && (Number(counts.products) > 0 || Number(counts.sales) > 0);
}

function result(scenario, verdict, headline, explanation, steps, options = {}) {
    return {
        scenarioId: scenario.id,
        verdict,
        headline,
        explanation,
        steps,
        localCounts: { ...scenario.local.counts },
        backupCounts: scenario.backup.counts ? { ...scenario.backup.counts } : null,
        backupAgeMinutes: Number.isFinite(scenario.backup.ageMinutes) ? scenario.backup.ageMinutes : null,
        maxBackupAgeMinutes: RECOVERY_LAB_MAX_BACKUP_AGE_MINUTES,
        policy: {
            recoveryOnlyForPrimary: true,
            detectedIdentity: scenario.deviceId || 'ausente',
            primaryIdentity: PRIMARY_POS_DEVICE_ID,
            blockCloudPublish: options.blockCloudPublish ?? true,
            cloudWritesPerformed: 0,
            localWritesPerformed: 0,
            networkRequestsPerformed: 0,
            note: 'Simulación aislada: no se leyó ni escribió almacenamiento real y no se contactó ningún servicio.',
        },
    };
}

/**
 * Runs one deterministic recovery decision against a fixed synthetic fixture.
 * This module intentionally has no browser-storage, network, or Supabase imports.
 */
export function simulateRecoveryScenario(scenarioId) {
    const scenario = RECOVERY_LAB_SCENARIOS.find(item => item.id === scenarioId);
    if (!scenario) throw new RangeError(`Escenario de laboratorio desconocido: ${scenarioId}`);

    const steps = [makeStep('Leer escenario sintético', 'passed', 'Solo datos ficticios incluidos en el laboratorio.')];

    if (scenario.mode === 'monitor') {
        steps.push(makeStep('Validar ámbito', 'skipped', 'El modo Supervisor no participa en el failover de caja.'));
        return result(scenario, 'not-applicable', 'No aplica al monitor', scenario.description, steps);
    }

    if (scenario.deviceId !== PRIMARY_POS_DEVICE_ID) {
        steps.push(makeStep('Validar identidad de caja', 'blocked', 'El ID está ausente o no es el ID principal confirmado.'));
        steps.push(makeStep('Restaurar o publicar', 'blocked', 'No se toma ninguna acción automática ante identidad incierta.'));
        return result(scenario, 'identity-unverified', 'Identidad no confirmada', scenario.description, steps);
    }
    steps.push(makeStep('Validar identidad de caja', 'passed', 'Coincide exactamente con PRIMARY_POS_DEVICE_ID.'));

    if (scenario.local.read !== 'ok') {
        steps.push(makeStep('Leer datos locales críticamente', 'failed', 'La lectura falló; un error nunca se convierte en un array vacío válido.'));
        steps.push(makeStep('Subida cloud', 'blocked', 'Se bloquea para no propagar un cero producido por una lectura incierta.'));
        return result(scenario, 'protected-read-error', 'Caja protegida: lectura incierta', scenario.description, steps);
    }
    steps.push(makeStep('Leer datos locales críticamente', 'passed', 'Las lecturas del escenario terminaron sin errores.'));

    if (scenario.importInProgress) {
        steps.push(makeStep('Comprobar operaciones pendientes', 'waiting', 'Hay una importación en curso; la detección se difiere.'));
        steps.push(makeStep('Subida cloud', 'blocked', 'No se publica el estado temporal de una importación.'));
        return result(scenario, 'deferred-import', 'Esperando a que termine la importación', scenario.description, steps);
    }

    if (scenario.intentionalEmptyConfirmed) {
        steps.push(makeStep('Comprobar intención', 'passed', 'El escenario indica un vaciado intencional confirmado.'));
        steps.push(makeStep('Restauración automática', 'skipped', 'Se respeta la acción explícita; no se restaura una copia anterior.'));
        steps.push(makeStep('Publicación automática del laboratorio', 'skipped', 'El laboratorio no publica nada; la sincronización real queda fuera de la simulación.'));
        return result(scenario, 'intentional-empty', 'Vaciado intencional: no restaurar', scenario.description, steps, { blockCloudPublish: false });
    }

    if (scenario.freshInstall && !scenario.local.hasPriorDataEvidence && isAllCriticalDataEmpty(scenario.local.counts)) {
        steps.push(makeStep('Detectar instalación nueva', 'passed', 'No hay evidencia de datos anteriores; no se confunde con pérdida.'));
        steps.push(makeStep('Restauración automática', 'skipped', 'La caja queda vacía hasta completar su configuración inicial.'));
        return result(scenario, 'fresh-install', 'Instalación nueva: no restaurar', scenario.description, steps);
    }

    if (!isAllCriticalDataEmpty(scenario.local.counts)) {
        steps.push(makeStep('Evaluar conteos', 'passed', 'Hay datos locales; no se activa la recuperación de cero total.'));
        steps.push(makeStep('Restauración automática', 'skipped', 'No reemplazar datos locales existentes con una copia anterior.'));
        return result(scenario, 'local-data-present', 'Datos locales presentes: no restaurar', scenario.description, steps, { blockCloudPublish: false });
    }

    steps.push(makeStep('Detectar cero total', 'passed', 'Productos, ventas, clientes y cuentas aparecen vacíos en una lectura válida.'));

    if (!scenario.local.hasPriorDataEvidence) {
        steps.push(makeStep('Comprobar evidencia previa', 'failed', 'No hay evidencia confiable de que esta caja hubiera tenido datos.'));
        steps.push(makeStep('Subida cloud', 'blocked', 'No se sube el cero mientras la causa sea ambigua.'));
        return result(scenario, 'protected-no-evidence', 'Caja protegida: pérdida no confirmada', scenario.description, steps);
    }
    steps.push(makeStep('Comprobar evidencia previa', 'passed', 'Una marca sintética confirma que antes había datos.'));

    if (scenario.backup.status === 'error') {
        steps.push(makeStep('Consultar copia cloud', 'failed', 'La consulta falló; no se interpreta como ausencia de backup.'));
        steps.push(makeStep('Subida cloud', 'blocked', 'No sobrescribir una copia posiblemente recuperable.'));
        return result(scenario, 'protected-cloud-error', 'Caja protegida: Cloud no verificable', scenario.description, steps);
    }
    if (scenario.backup.status !== 'present') {
        steps.push(makeStep('Consultar copia cloud', 'failed', 'No hay una copia recuperable disponible en el escenario.'));
        steps.push(makeStep('Subida cloud', 'blocked', 'No existe una fuente validada para recuperar y no se publica el cero.'));
        return result(scenario, 'protected-no-backup', 'Caja protegida: no hay copia', scenario.description, steps);
    }
    steps.push(makeStep('Consultar copia cloud', 'passed', 'El escenario contiene una copia sintética.'));

    if (!scenario.backup.complete || !scenario.backup.integrityValid || !countsAreUseful(scenario.backup.counts)) {
        steps.push(makeStep('Validar copia', 'failed', 'La copia no es completa, íntegra o tiene conteos críticos insuficientes.'));
        steps.push(makeStep('Subida cloud', 'blocked', 'No se aplica una copia defectuosa ni se publica el cero.'));
        return result(scenario, 'protected-invalid-backup', 'Caja protegida: copia inválida', scenario.description, steps);
    }
    steps.push(makeStep('Validar copia', 'passed', 'Es completa, íntegra y contiene productos o ventas.'));

    if (scenario.backup.ageMinutes > RECOVERY_LAB_MAX_BACKUP_AGE_MINUTES) {
        steps.push(makeStep('Validar antigüedad', 'warning', `Supera el umbral de ${RECOVERY_LAB_MAX_BACKUP_AGE_MINUTES} minutos; necesita aprobación humana.`));
        steps.push(makeStep('Subida cloud', 'blocked', 'No publicar ni restaurar automáticamente una copia antigua.'));
        return result(scenario, 'approval-required', 'Copia antigua: requiere confirmación', scenario.description, steps);
    }
    steps.push(makeStep('Validar antigüedad', 'passed', `Dentro del umbral de ${RECOVERY_LAB_MAX_BACKUP_AGE_MINUTES} minutos.`));
    steps.push(makeStep('Guardar salvaguarda local', 'passed', 'Simulación: preservaría primero el estado local sospechoso.'));
    steps.push(makeStep('Preparar restauración atómica', 'passed', 'Simulación: prepara todas las claves antes de confirmar el commit.'));

    if (scenario.failDuringRestore) {
        steps.push(makeStep('Aplicar y verificar', 'failed', 'Fallo inyectado antes del commit; la operación simulada revierte.'));
        steps.push(makeStep('Subida cloud', 'blocked', 'No reanudar sincronización sin verificación posterior al commit.'));
        return result(scenario, 'restore-aborted', 'Restauración interrumpida: datos protegidos', scenario.description, steps);
    }

    steps.push(makeStep('Aplicar y verificar', 'passed', 'Los conteos restaurados coinciden con la copia validada.'));
    steps.push(makeStep('Reanudar sincronización', 'passed', 'Solo se permitiría después de verificar el commit restaurado.'));
    return result(scenario, 'recovered', 'Recuperación simulada completada', scenario.description, steps, { blockCloudPublish: false });
}

/**
 * Executes every synthetic fixture and returns an aggregate audit report.
 * This stays deterministic and does not access application state or services.
 */
export function runRecoveryLabSuite() {
    const evaluations = RECOVERY_LAB_SCENARIOS.map(scenario => ({
        scenarioId: scenario.id,
        label: scenario.label,
        result: simulateRecoveryScenario(scenario.id),
    }));
    const verdictCounts = evaluations.reduce((counts, evaluation) => {
        counts[evaluation.result.verdict] = (counts[evaluation.result.verdict] || 0) + 1;
        return counts;
    }, {});

    return {
        total: evaluations.length,
        recovered: evaluations.filter(item => item.result.verdict === 'recovered').length,
        protected: evaluations.filter(item => item.result.policy.blockCloudPublish).length,
        deferred: evaluations.filter(item => item.result.verdict === 'deferred-import').length,
        notApplicable: evaluations.filter(item => item.result.verdict === 'not-applicable').length,
        verdictCounts,
        safety: {
            noNetworkRequests: evaluations.every(item => item.result.policy.networkRequestsPerformed === 0),
            noLocalWrites: evaluations.every(item => item.result.policy.localWritesPerformed === 0),
            noCloudWrites: evaluations.every(item => item.result.policy.cloudWritesPerformed === 0),
        },
        evaluations,
    };
}
