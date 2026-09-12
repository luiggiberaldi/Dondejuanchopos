/**
 * prepareSalesPushPayload (salesPushMerge.js) — FASE 1 del plan maestro.
 *
 * Convierte un push de ventas "todo o nada" en una UNIÓN segura por id,
 * con veto duro de no-encogimiento y referencia cloud real (leída por RPC).
 *
 * Invariantes (todas testeadas en tests/salesPushMerge.test.js):
 *  I1. NUNCA devuelve un array con menos registros que la base cloud de referencia.
 *  I2. Los registros sellados (cierreId/cajaCerrada) se preservan en su versión más
 *      avanzada (la lógica vive en mergeSalesArrays, aquí solo se delega).
 *  I3. Idempotente: fusionar dos veces el mismo contenido no duplica nada.
 *  I4. Si no hay base cloud de referencia, el resultado es exactamente el array local
 *      (comportamiento idéntico al push actual — no introduce cambios).
 *  I5. En empate de `updatedAt` entre local y cloud, GANA LA NUBE: el dispositivo
 *      con historial truncado no puede resucitar versiones viejas que ya fueron
 *      corregidas/canonizadas en la nube (incidente 11-09/12-09).
 */

import { mergeSalesArrays } from './salesMerge';
import { supabaseCloud } from '../config/supabaseCloud';

/** Doc canónico de ventas en la nube. */
export const SALES_CLOUD_CACHE_KEY = 'bodega_sales_v1';

/**
 * RPC SECURITY DEFINER existente: valida que (primary, monitor) estén emparejados
 * y devuelve el documento solicitado. No se concede SELECT sobre sync_documents.
 * NOTA: la autorización recae en el vínculo device_pairings — una identidad
 * suplantada que conozca ambos device_ids podría leer el Doc 60. Es la misma
 * superficie que ya usa el Supervisor hoy (FASE 3A cierra esto con fingerprints).
 */
const READ_RPC = 'read_paired_audit_documents';
const MONITOR_ID_CACHE_KEY = 'dj_cloud_merge_monitor_id';
/** TTL de la referencia cloud: coalesce ráfagas sin permitir divergencia larga. */
const SALES_REF_TTL_MS = 15000;

let _inFlightRef = null;
let _refCache = { payload: null, ts: 0 };

/**
 * Resuelve el monitor vinculado a este POS. La tabla device_pairings es legible
 * por anon (solo expone ids de dispositivo, no datos de negocio). Se cachea en
 * localStorage porque el vínculo no cambia en caliente.
 */
async function resolveMonitorDeviceId(deviceId, client) {
    try {
        const cached = localStorage.getItem(MONITOR_ID_CACHE_KEY);
        if (cached) return cached;
        const { data, error } = await client
            .from('device_pairings')
            .select('monitor_device_id')
            .eq('primary_device_id', deviceId)
            .maybeSingle();
        if (error || !data?.monitor_device_id) return null;
        localStorage.setItem(MONITOR_ID_CACHE_KEY, data.monitor_device_id);
        return data.monitor_device_id;
    } catch {
        return null;
    }
}

/**
 * Lee la copia canónica del Doc 60 para usarla como base del merge-on-push.
 * Devuelve un Array o null (cualquier fallo → null → el caller hace passthrough
 * y el circuit breaker clásico sigue protegiendo, sin regresión).
 *
 * Con TTL de 15s + single-flight: ráfagas de ventas comparten una sola lectura.
 * Compromiso conocido: si otro escritor legítimo actualizara el Doc 60 dentro de
 * esa ventana, el push fusionado podría no incluir ese cambio en el documento
 * resultante. Hoy el único escritor de ventas es el propio POS (el Monitor es
 * read-only), así que la ventana es inocua; FASE 3A/3B la elimina del todo.
 *
 * @param {string} deviceId - device_id de ESTE dispositivo (el dueño del doc).
 * @param {object} [client] - cliente Supabase inyectable para tests.
 * @returns {Promise<Array|null>}
 */
export async function fetchCloudSalesReference(deviceId, client = supabaseCloud) {
    if (!client || !deviceId) return null;
    try {
        const now = Date.now();
        if (_refCache.payload && now - _refCache.ts < SALES_REF_TTL_MS) {
            return _refCache.payload;
        }
        if (_inFlightRef) return _inFlightRef;

        _inFlightRef = (async () => {
            const monitorDeviceId = await resolveMonitorDeviceId(deviceId, client);
            if (!monitorDeviceId) return null;

            const { data, error } = await client.rpc(READ_RPC, {
                p_primary_device_id: deviceId,
                p_monitor_device_id: monitorDeviceId,
                p_doc_ids: [SALES_CLOUD_CACHE_KEY],
            });
            if (error || !Array.isArray(data) || data.length === 0) return null;

            const payload = data[0]?.data?.payload;
            if (!Array.isArray(payload)) return null;

            _refCache = { payload, ts: Date.now() };
            return payload;
        })();

        return await _inFlightRef;
    } catch {
        return null;
    } finally {
        _inFlightRef = null;
    }
}

/** Reservado para tests: invalida la caché de referencia cloud. */
export function resetCloudSalesReferenceCacheForTests() {
    _refCache = { payload: null, ts: 0 };
    _inFlightRef = null;
}

/**
 * Prepara el payload a subir para bodega_sales_v1.
 *
 * @param {Array} localSales - Ventas locales del dispositivo (lo que se quería subir).
 * @param {Array|null} cloudReference - Copia canónica del Doc 60 (o null).
 * @returns {{ payload: Array, strategy: 'union-merge'|'passthrough', vetoed: boolean, reason?: string }}
 */
export function prepareSalesPushPayload(localSales, cloudReference) {
    const isLocalArray = Array.isArray(localSales);

    // Sin base de referencia cloud no hay nada que fusionar: passthrough tal cual
    // (el circuit breaker existente sigue aplicando aguas abajo).
    if (!Array.isArray(cloudReference) || cloudReference.length === 0) {
        return { payload: isLocalArray ? localSales : [], strategy: 'passthrough', vetoed: false };
    }
    if (!isLocalArray) {
        // Payload local corrupto: jamás sustituir la nube por basura.
        return { payload: cloudReference, strategy: 'union-merge', vetoed: false, reason: 'local-no-array' };
    }

    // ── UNIÓN POR ID, CON LA NUBE COMO LADO QUE GANA EMPATES ──
    // Convención de mergeSalesArrays(incoming, local): `incoming` gana empates de
    // updatedAt. Pasamos (cloud, local) para acercarnos a I5.
    const merged = mergeSalesArrays(cloudReference, localSales);

    // ── CANONIZACIÓN DE SELLADOS (I5 estricta) ──
    // "Regla de Oro 5" de salesMerge.js deja ganar el segundo lado para summaries de
    // REGISTRO_CIERRE; en el push eso permitiría a un local truncado pisar un cierre
    // ya corregido en la nube (incidente 11-09). Aquí mandamos la nube para cualquier
    // registro sellado que exista en la referencia, SALVO que la copia local sea
    // ESTRICTAMENTE más nueva (correcciones legítimas aplicadas por comando).
    const cloudById = new Map(
        cloudReference.filter(s => s && typeof s === 'object' && s.id).map(s => [s.id, s]),
    );
    const canonizado = merged.map((rec) => {
        if (!rec || typeof rec !== 'object' || !rec.id || rec.tipo !== 'REGISTRO_CIERRE') return rec;
        const cloudCopy = cloudById.get(rec.id);
        if (!cloudCopy || cloudCopy.tipo !== 'REGISTRO_CIERRE') return rec;
        const localTs = new Date(rec.updatedAt || rec.timestamp || 0).getTime();
        const cloudTs = new Date(cloudCopy.updatedAt || cloudCopy.timestamp || 0).getTime();
        // El sello y el summary son inmutables por diseño: la nube gana salvo
        // que el local sea estrictamente posterior.
        return localTs > cloudTs ? rec : cloudCopy;
    });

    if (canonizado.length < cloudReference.length) {
        // Defensa en profundidad (mergeSalesArrays es union, no debería ocurrir).
        return {
            payload: cloudReference,
            strategy: 'union-merge',
            vetoed: true,
            reason: `merge encogió el array (${canonizado.length} < ${cloudReference.length}); se usa la referencia cloud intacta`,
        };
    }

    return { payload: canonizado, strategy: 'union-merge', vetoed: false };
}
