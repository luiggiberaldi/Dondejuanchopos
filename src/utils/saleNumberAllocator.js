/**
 * saleNumberAllocator.js — FASE 3B del plan maestro.
 *
 * Termina con el "tobogán" de saleNumber duplicados: el número de venta se
 * asigna desde la NUBE al facturar, no con max(local)+1 (que colisionaba
 * siempre que el historial local se truncaba — incidentes 08-09, 11-09, 12-09;
 * docenas de duplicados renumerados quirúrgicamente el 12-09).
 *
 * Diseño (dos capas, SIN DDL nuevo):
 *
 *  1. LÍNEA BASE — el Doc 60 canónico (bodega_sales_v1) ya está en la lista
 *     blanca de read_paired_audit_documents: candidato = max(saleNumber)+1.
 *     No requiere contador inicial: el bootstrap ES el estado de la nube.
 *
 *  2. RECLAMO ATÓMICO — el candidato se reclama insertando una fila en
 *     supervisor_commands: {action:'sale_number_claim', candidate, instanceId}.
 *     Los INSERT de Postgres serializan; el reclamo es la unidad de carrera.
 *     Tras insertar, el reclamador lee TODOS los reclamos recientes y corre una
 *     COMPACTACIÓN SECUENCIAL determinista (ver resolveClaims): el reclamador
 *     con el candidato más bajo gana su número; los colisionados se corren
 *     hacia arriba de forma predecible para todos los que vean el mismo estado.
 *     Las filas de reclamo NO se borran (son el estado de coordinación; se
 *     filtran por edad y el Monitor puede ocultarlas).
 *
 *  3. FALLBACK OFFLINE — sin nube (timeout 4s o error): max(local)+1 marcado
 *     PROVISIONAL (saleNumberProvisional) con guardia monótona: nunca devolver
 *     un número ≤ max local conocido. El push de FASE 1 (unión) y la regla
 *     "la nube gana empates" absorben estos pocos provisionales; el renumber
 *     idempotente limpia cualquier colisión residual.
 *
 * Realidad operativa: un solo cajero factura; las carreras reales son ~cero.
 * La compactación existe para que NI SIQUIERA esas ráfagas generen duplicados.
 */

import { supabaseCloud } from '../config/supabaseCloud';
import { fetchCloudSalesReference } from './salesPushMerge';

const CLAIM_ACTION = 'sale_number_claim';
const CLAIM_MAX_AGE_MS = 24 * 60 * 60 * 1000; // los reclamos coordinan por 24h
const ALLOC_TIMEOUT_MS = 4000;                // presupuesto total de la asignación
const MONITOR_CACHE_KEY = 'dj_cloud_merge_monitor_id';

/** Máximo saleNumber de un array de registros (0 si no hay).
 *  Cuenta CUALQUIER registro con saleNumber numérico (VENTA, COBRO_DEUDA,
 *  VENTA_FIADA, ...): los abonos también consumen numeración y vivir ciego a
 *  ellos reprodujera el bug de duplicados que esta fase elimina. */
export function maxSaleNumberOf(sales) {
    let max = 0;
    for (const s of sales || []) {
        const n = Number(s?.saleNumber);
        if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
}

/**
 * Compacción secuencial determinista de reclamos.
 * Orden: candidate asc, luego createdAt asc, luego claimKey asc (desempate total).
 * Camina asignando: si candidate >= cursor → recibe candidate (cursor = candidate+1);
 * si candidate < cursor (colisión) → recibe cursor (cursor+1).
 * Devuelve un Map claimKey → número asignado.
 *
 * @param {Array<{claimKey:string, candidate:number, createdAt:string}>} claims
 * @returns {Map<string,number>}
 */
export function resolveClaims(claims) {
    const assigned = new Map();
    const sorted = [...(claims || [])].sort((a, b) =>
        (a.candidate - b.candidate)
        || String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
        || String(a.claimKey || '').localeCompare(String(b.claimKey || '')),
    );
    let cursor = sorted.length ? Math.max(1, sorted[0].candidate) : 1;
    for (const c of sorted) {
        const cand = Number(c.candidate);
        let num;
        if (Number.isFinite(cand) && cand >= cursor) {
            num = cand;
            cursor = cand + 1;
        } else {
            num = cursor;
            cursor += 1;
        }
        assigned.set(c.claimKey, num);
    }
    return assigned;
}

/** Marca una venta como numeración provisional (fallback offline). */
export function withProvisionalMark(sale, note) {
    return {
        ...sale,
        saleNumberProvisional: true,
        saleNumberNote: String(note || '').slice(0, 200),
    };
}

/** Monitor vinculado (misma caché que FASE 1/3A). */
async function resolveMonitorDeviceId(deviceId, client) {
    try {
        const cached = localStorage.getItem(MONITOR_CACHE_KEY);
        if (cached) return cached;
        const { data, error } = await client
            .from('device_pairings')
            .select('monitor_device_id')
            .eq('primary_device_id', deviceId)
            .maybeSingle();
        if (error || !data?.monitor_device_id) return null;
        localStorage.setItem(MONITOR_CACHE_KEY, data.monitor_device_id);
        return data.monitor_device_id;
    } catch {
        return null;
    }
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, rej) => setTimeout(() => rej(new Error('alloc-timeout')), ms)),
    ]);
}

function getInstanceIdSafe() {
    try {
        return localStorage.getItem('dj_instance_id') || 'sin-fingerprint';
    } catch {
        return 'sin-fingerprint';
    }
}

/** UUID por llamada (fallback determinista si crypto no está disponible). */
function newCallUuid() {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch { /* cae al fallback */ }
    return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Asigna el próximo saleNumber desde la nube.
 *
 * @param {string} deviceId - device_id del dispositivo (dueño del Doc 60).
 * @param {object} [opts]
 * @param {Array}  [opts.localSales] - bodega_sales_v1 local (para fallback).
 * @param {object} [opts.client]     - cliente Supabase inyectable (tests).
 * @param {string} [opts.now]        - timestamp inyectable (tests).
 * @returns {Promise<{saleNumber:number, provisional:boolean, source:'cloud'|'fallback', note?:string}>}
 */
export async function allocateSaleNumber(deviceId, { localSales = null, client = supabaseCloud, now = new Date().toISOString() } = {}) {
    const localMax = maxSaleNumberOf(localSales);
    try {
        if (!client || !deviceId) throw new Error('alloc-sin-cliente');

        // ── Capa 1: línea base desde el Doc 60 (lectura fresca) ──
        const cloudRef = await withTimeout(
            fetchCloudSalesReference(deviceId, client, { fresh: true }),
            ALLOC_TIMEOUT_MS,
        );
        if (!Array.isArray(cloudRef) || cloudRef.length === 0) throw new Error('alloc-sin-referencia-cloud');

        // Guardia monótona: nunca proponer por debajo de lo que ya existe localmente
        // (evita re-asignar un número local aún no empujado).
        const candidate = Math.max(maxSaleNumberOf(cloudRef), localMax) + 1;

        // ── Capa 2: reclamo atómico ──
        const monitor = await resolveMonitorDeviceId(deviceId, client);
        if (!monitor) throw new Error('alloc-sin-monitor');
        // claimKey ÚNICO por llamada: dos allocations en el mismo milisegondo (doble
        // submit, ráfaga) con la misma instancia NO deben colapsar en el Map de
        // compactación — la unicidad la aporta el UUID, no el timestamp.
        const claimKey = `${deviceId}:${now}:${newCallUuid()}`;
        const claimPayload = {
            action: CLAIM_ACTION,
            candidate,
            claimKey,
            instanceId: getInstanceIdSafe(),
            requestedAt: now,
        };
        const ins = await withTimeout(
            client.from('supervisor_commands').insert({
                primary_device_id: deviceId,
                monitor_device_id: monitor,
                command_type: 'inventory_update',
                // RLS (supervisor_commands_monitor_insert) exige status='pending' en
                // el INSERT; el emisor SE CONFIRMA con un UPDATE a 'applied' justo
                // después (la política de UPDATE del par lo permite). Nadie procesa
                // esta fila como comando: es solo estado de coordinación legible por
                // todas las instancias del par.
                status: 'pending',
                payload: claimPayload,
            }),
            ALLOC_TIMEOUT_MS,
        );
        if (ins.error) throw new Error('alloc-claim-falló: ' + ins.error.message);
        const sel1 = await withTimeout(
            client.from('supervisor_commands')
                .update({ status: 'applied' })
                .contains('payload', { claimKey })
                .eq('status', 'pending'),
            ALLOC_TIMEOUT_MS,
        );
        if (sel1.error) throw new Error('alloc-confirm-falló: ' + sel1.error.message);

        // Releer reclamos recientes y correr la compactación determinista.
        // AGNÓSTICO de status: cuenta 'pending' (aún no confirmados) Y 'applied',
        // así el número ya se coordina aunque la confirmación de otro emisor tarde.
        // (Robusto: un `now` inválido no debe tumbar la vía cloud — se usa el reloj local.)
        const nowMs = new Date(now).getTime();
        const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
        const cutoff = new Date(baseMs - CLAIM_MAX_AGE_MS).toISOString();
        const sel = await withTimeout(
            client.from('supervisor_commands')
                .select('payload,created_at')
                .eq('primary_device_id', deviceId)
                .eq('command_type', 'inventory_update')
                .in('status', ['pending', 'applied'])
                .contains('payload', { action: CLAIM_ACTION })
                .gte('created_at', cutoff)
                .order('created_at', { ascending: false })
                .limit(200),
            ALLOC_TIMEOUT_MS,
        );
        if (sel.error) throw new Error('alloc-relectura-falló: ' + sel.error.message);

        const claims = (sel.data || [])
            .map((r) => r.payload)
            .filter((p) => p && p.claimKey && Number.isFinite(Number(p.candidate)))
            .map((p) => ({ claimKey: p.claimKey, candidate: Number(p.candidate), createdAt: p.requestedAt || '' }));
        const assigned = resolveClaims(claims);
        const myNumber = assigned.get(claimKey);
        if (!Number.isFinite(myNumber)) throw new Error('alloc-sin-asignación');

        return { saleNumber: myNumber, provisional: false, source: 'cloud' };
    } catch (err) {
        // ── Capa 3: fallback offline con guardia monótona ──
        const fallback = localMax + 1;
        return {
            saleNumber: fallback,
            provisional: true,
            source: 'fallback',
            note: `sin nube al facturar (${String(err?.message || err).slice(0, 120)}); numeración provisional — conciliar en el push`,
        };
    }
}
