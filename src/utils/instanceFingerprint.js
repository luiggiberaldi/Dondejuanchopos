/**
 * instanceFingerprint.js — FASE 3A del plan maestro.
 *
 * Aísla la "instancia fantasma": una segunda instalación del POS (dataset viejo
 * del 19-08) que opera bajo el MISMO device_id que la caja de producción y
 * consume comandos de supervisor (quemó 3: dos enable_feature y quedó a punto
 * de quemar replace_sales_history). Ver .agents/AGENTS.md §9.
 *
 * Diseño (según docs/FASE-2-HANDOFF §3 y AGENTS.md):
 *  - ID de instancia persistente por navegador: `dj_instance_id`
 *    (crypto.randomUUID; los navegadores sin crypto —el fantasma probablemente
 *    corre un build viejo— obtienen un fallback estable). Aparece en cada
 *    backup que la instancia sube, trazando SIEMPRE quién respondió.
 *  - Puerta de comandos con concesión central: cada instancia compara su id con
 *    `dj_gate_v1.primaryInstanceId` (doc `bodega_instance_gate_v1`, collection
 *    'local' — registrado por el orquestador tras VERIFICAR la instancia real).
 *    No registrado → fail-open (comportamiento actual, deploy seguro).
 *    Registrado y distinto → la instancia NO es la primaria: se salta el
 *    comando SIN consumirlo (queda pending para la caja real) y lo deja anotado.
 *  - Cache en memoria 60 s: 1 lectura RPC por minuto por instancia, no por comando.
 *
 * Nada de esto crea, borra ni mueve datos de negocio: solo decide quién
 * procesa comandos y firma los backups con su identidad.
 */

const INSTANCE_ID_KEY = 'dj_instance_id';
const GATE_DOC_ID = 'bodega_instance_gate_v1';
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
 * Lee la concesión central. null = no registrada aún (fail-open).
 * @param {string} deviceId
 * @param {object} [client] - cliente Supabase inyectable (tests).
 */
export async function readGate(deviceId, client) {
    try {
        const now = Date.now();
        if (_cachedGate.value !== null && now - _cachedGate.ts < GATE_TTL_MS) {
            return _cachedGate.value;
        }
        const { data, error } = await client.rpc('read_paired_audit_documents', {
            p_primary_device_id: deviceId,
            p_monitor_device_id: deviceId, // el gate es del dispositivo, no del par
            p_doc_ids: [GATE_DOC_ID],
        });
        if (error) throw error;
        const payload = data?.[0]?.data?.payload;
        _cachedGate = { value: payload || null, ts: Date.now() };
        return _cachedGate.value;
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
