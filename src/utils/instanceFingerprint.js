/**
 * instanceFingerprint.js — FASE 3A del plan maestro.
 *
 * Aísla la "instancia fantasma": una segunda instalación del POS (dataset viejo
 * del 19-08) que opera bajo el MISMO device_id que la caja de producción y
 * consume comandos de supervisor (quemó 3: dos enable_feature y quedó a punto
 * de quemar replace_sales_history). Ver .agents/AGENTS.md §9.
 *
 * Diseño:
 *  - ID de instancia persistente por navegador: `dj_instance_id`
 *    (crypto.randomUUID; navegadores sin crypto obtienen un fallback estable).
 *    Aparece en cada backup que la instancia sube (`instanceId`), trazando
 *    SIEMPRE quién respondió.
 *  - Concesión central "gate": la instancia más reciente anuncia su id en
 *    supervisor_commands como { action: 'instance_gate', primaryInstanceId }
 *    (command_type='inventory_update', insertada directamente en status
 *    'applied' — NUNCA es procesada como comando; es solo un dato persistente
 *    legible por todas las instancias, que ya leen esa tabla para hacer polling).
 *    Elegimos este canal porque read_paired_audit_documents tiene lista blanca
 *    de doc_ids (agregar uno exige DDL) y supervisor_commands ya es legible por
 *    anon con los permisos existentes.
 *  - No registrada → fail-open (comportamiento previo, despliegue seguro).
 *    Registrada y distinta → la instancia NO es la primaria: se salta el
 *    comando SIN consumirlo (queda pending para la caja real).
 *  - Cache en memoria 60 s: una lectura por minuto por instancia, no por comando.
 *
 * Nada de esto crea, borra ni mueve datos de negocio: solo decide quién
 * procesa comandos y firma los backups con su identidad.
 */

const INSTANCE_ID_KEY = 'dj_instance_id';
const GATE_ACTION = 'instance_gate';
const GATE_TTL_MS = 60 * 1000;

let _cachedGate = { value: null, ts: 0 };

/** ID persistente de ESTA instancia de navegador. */
export function getInstanceId() {
    try {
        let id = localStorage.getItem(INSTANCE_ID_KEY);
        if (id) return id;
        id = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `inst-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(INSTANCE_ID_KEY, id);
        return id;
    } catch {
        return 'unavailable';
    }
}

/** ¿Estamos ejecutando bajo un Service Worker (los builds POS lo registran)? */
export function hasServiceWorker() {
    try {
        return Boolean(navigator && navigator.serviceWorker);
    } catch {
        return false;
    }
}

/**
 * Lee el anuncio de gate más reciente para este device.
 * null = no registrado aún (fail-open aguas abajo).
 * @param {string} deviceId
 * @param {object} [client] - cliente Supabase inyectable (tests).
 */
export async function readGate(deviceId, client) {
    try {
        const now = Date.now();
        if (_cachedGate.value !== null && now - _cachedGate.ts < GATE_TTL_MS) {
            return _cachedGate.value;
        }
        // El anuncio vive como fila applied (jamás pending) → ningún dispositivo
        // la consume como comando; todas la leen como dato.
        // NOTA: la tabla viva NO tiene updated_at; el orden correcto es created_at.
        const { data, error } = await client
            .from('supervisor_commands')
            .select('payload')
            .eq('primary_device_id', deviceId)
            .eq('command_type', 'inventory_update')
            .eq('status', 'applied')
            .contains('payload', { action: GATE_ACTION })
            .order('created_at', { ascending: false })
            .limit(1);
        if (error) throw error;
        const payload = data?.[0]?.payload || null;
        _cachedGate = { value: payload, ts: Date.now() };
        return payload;
    } catch {
        return null;
    }
}

/** Invalida la caché del gate (tests). */
export function resetGateCacheForTests() {
    _cachedGate = { value: null, ts: 0 };
}

/**
 * Decisión de la puerta: ¿puede ESTA instancia procesar comandos?
 * Pure function — el cableado la llama con (gate, myId).
 *
 *  - gate null / sin primaryInstanceId → { allowed: true } (fail-open).
 *  - gate.primaryInstanceId === myId   → { allowed: true }.
 *  - distinto                          → { allowed: false } (NO consumir).
 *
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function canProcessCommands(gate, myId) {
    if (!gate || typeof gate !== 'object' || !gate.primaryInstanceId) {
        return { allowed: true, reason: 'gate-sin-registrar' };
    }
    if (gate.primaryInstanceId === myId) {
        return { allowed: true, reason: 'instancia-primaria' };
    }
    return {
        allowed: false,
        reason: `no-es-instancia-primaria (gate=${String(gate.primaryInstanceId).slice(0, 8)}, local=${String(myId).slice(0, 8)})`,
    };
}
