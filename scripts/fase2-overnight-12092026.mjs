#!/usr/bin/env node
/**
 * scripts/fase2-overnight-12092026.mjs
 *
 * Orquestador de FASE 2 (reconstrucción del historial del PC desde el Doc 60).
 * Proceso de larga duración: dispara las fases en el orden exacto de
 * docs/FASE-2-HANDOFF-REPLACE-SALES-HISTORY.md §5:
 *
 *   1. Espera a que la caja esté CERRADA (último cierre > última apertura).
 *   2. request_full_backup → espera backup <10 min.
 *   3. replace_sales_history phase=prepare → espera applied; si failed, reintenta.
 *   4. Verifica el token del encolador contra lectura fresca propia del Doc 60.
 *   5. phase=apply con confirmToken → espera applied/applied_with_warnings.
 *   6. request_full_backup final y verificación: historial local del PC == Doc 60.
 *
 * Uso:  node scripts/fase2-overnight-12092026.mjs            (armar y monitorear)
 *       DRY=1 node ... (muestra el plan sin encolar nada)
 * Log:  tee a logs/fase2-overnight.log
 */

import fs from 'node:fs';

const ENV = {};
fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2];
});

const CLOUD_URL = ENV.VITE_SUPABASE_CLOUD_URL;
const CLOUD_KEY = ENV.VITE_SUPABASE_CLOUD_KEY;
const DEVICE = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
const DRY = process.env.DRY === '1';

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(CLOUD_URL, CLOUD_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function getMonitorId() {
    const { data, error } = await sb
        .from('device_pairings')
        .select('monitor_device_id')
        .eq('primary_device_id', DEVICE)
        .maybeSingle();
    if (error || !data?.monitor_device_id) throw new Error('sin pairing: ' + (error?.message || 'vacío'));
    return data.monitor_device_id;
}

async function readDoc60(monitor) {
    const { data, error } = await sb.rpc('read_paired_audit_documents', {
        p_primary_device_id: DEVICE,
        p_monitor_device_id: monitor,
        p_doc_ids: ['bodega_sales_v1'],
    });
    if (error) throw new Error('RPC Doc 60: ' + error.message);
    const payload = data?.[0]?.data?.payload;
    if (!Array.isArray(payload)) throw new Error('Doc 60 sin payload');
    return payload;
}

function shiftState(payload) {
    let lastAp = null, lastCi = null;
    for (const s of payload) {
        if (!s || typeof s !== 'object') continue;
        const ts = String(s.timestamp || '');
        if (s.tipo === 'APERTURA_CAJA' && (!lastAp || ts > String(lastAp.timestamp))) lastAp = s;
        if (s.tipo === 'REGISTRO_CIERRE' && (!lastCi || ts > String(lastCi.timestamp))) lastCi = s;
    }
    return {
        open: Boolean(lastAp) && String(lastAp?.timestamp) > String(lastCi?.timestamp || ''),
        lastAp, lastCi,
        cierres: payload.filter((s) => s?.tipo === 'REGISTRO_CIERRE').length,
        maxSale: Math.max(0, ...payload.filter((s) => s?.tipo === 'VENTA').map((s) => Number(s.saleNumber) || 0)),
        total: payload.length,
    };
}

function computeToken(payload) {
    const cierres = payload.filter((s) => s?.tipo === 'REGISTRO_CIERRE').length;
    return `${cierres}:${shiftState(payload).maxSale}:${payload.length}`;
}

async function enqueueCommand(payload, note) {
    const monitor = await getMonitorId();
    const { data, error } = await sb
        .from('supervisor_commands')
        .insert({
            primary_device_id: DEVICE,
            monitor_device_id: monitor,
            command_type: 'inventory_update',
            status: 'pending',
            payload,
        })
        .select('id')
        .single();
    if (error) throw new Error('INSERT comando (' + note + '): ' + error.message);
    log(`encolado ${note}: ${data.id}`);
    return data.id;
}

async function waitCommand(id, { timeoutMs = 25 * 60 * 1000, pollMs = 20 * 1000 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        await sleep(pollMs);
        const { data, error } = await sb.from('supervisor_commands').select('status,error_reason,updated_at').eq('id', id).single();
        if (error) { log(`  (reintento lectura estado: ${error.message})`); continue; }
        if (data.status !== 'pending') return data;
        process.stdout.write('.');
    }
    return { status: 'timeout' };
}

async function lastBackupAgeMinutes(monitor) {
    const { data, error } = await sb.rpc('read_paired_cloud_backup', {
        p_primary_device_id: DEVICE,
        p_monitor_device_id: monitor,
        p_updated_after: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    if (error || !Array.isArray(data) || data.length === 0) return Infinity;
    const ts = new Date(data[0].updated_at).getTime();
    return (Date.now() - ts) / 60000;
}

// ═══════════════════════════════ ORQUESTACIÓN ═══════════════════════════════

const monitor = await getMonitorId();
log(`orquestador FASE 2 iniciado (dispositivo ${DEVICE.slice(-8)}, monitor ${monitor.slice(0, 14)}…)`);

// ── PASO 1: esperar caja cerrada ──
log('esperando cierre de caja (último cierre > última apertura en Doc 60)…');
let state = null;
while (true) {
    const payload = await readDoc60(monitor);
    state = shiftState(payload);
    if (!state.open) break;
    log(`turno AÚN ABIERTO (apertura ${state.lastAp?.timestamp}) — revisando en 5 min… (DRY=${DRY ? 1 : 0})`);
    if (DRY) { log('[DRY] abortando aquí: la orquestación real esperaría el cierre.'); process.exit(0); }
    await sleep(5 * 60 * 1000);
}
log(`caja CERRADA ✔ (último cierre ${state.lastCi?.timestamp}) | Doc 60: ${state.total} registros, ${state.cierres} cierres, maxSale #${state.maxSale}`);

// ── PASO 2: backup completo fresco (red de seguridad de prepare) ──
let backupAge = await lastBackupAgeMinutes(monitor);
log(`backup más reciente: hace ${backupAge === Infinity ? '∞' : backupAge.toFixed(1)} min`);
if (backupAge > 10) {
    if (DRY) { log('[DRY] encolaría request_full_backup'); }
    else {
        const realId = await enqueueRealFullBackup(monitor);
        log('esperando backup (máx 25 min)…');
        const r = await waitCommand(realId, { timeoutMs: 25 * 60 * 1000, pollMs: 30 * 1000 });
        if (r.status !== 'applied') throw new Error('request_full_backup no se aplicó: ' + JSON.stringify(r));
        backupAge = await lastBackupAgeMinutes(monitor);
        if (backupAge > 10) throw new Error(`backup no verificado tras apply (edad ${backupAge.toFixed(1)} min)`);
        log(`backup verificado ✔ (hace ${backupAge.toFixed(1)} min)`);
    }
}

// ── PASO 3: prepare (con reintentos ante SW viejo) ──
const cloudNow = await readDoc60(monitor);
const token = computeToken(cloudNow);
const st = shiftState(cloudNow);
log(`token del encolador: ${token} (cierres ${st.cierres}, maxSale #${st.maxSale}, ${st.total} registros)`);

let prepareId = null;
if (DRY) {
    log('[DRY] encolaría replace_sales_history phase=prepare');
} else {
    for (let intento = 1; intento <= 8; intento++) {
        prepareId = await enqueueCommand({ action: 'replace_sales_history', phase: 'prepare' }, `prepare (intento ${intento})`);
        const r = await waitCommand(prepareId);
        if (r.status === 'applied') { log(`prepare APLICADO ✔ (intento ${intento})`); break; }
        log(`prepare intento ${intento} → ${r.status}: ${r.error_reason || ''}`);
        if (intento === 8) throw new Error('prepare agotó reintentos');
        await sleep(3.5 * 60 * 1000);
    }
}

// ── PASO 4: verificación propia del token ──
const cloudForApply = await readDoc60(monitor);
const tokenNow = computeToken(cloudForApply);
if (tokenNow !== token) {
    throw new Error(`la nube se movió entre prepare y apply (${token} → ${tokenNow}); re-ejecutar prepare`);
}
log(`token verificado ✔ (${tokenNow})`);

// ── PASO 5: apply ──
if (DRY) {
    log('[DRY] encolaría replace_sales_history phase=apply con token ' + tokenNow);
    log('[DRY] fin del plan.');
    process.exit(0);
}

let applyResult = null;
for (let intento = 1; intento <= 8; intento++) {
    const applyId = await enqueueCommand({ action: 'replace_sales_history', phase: 'apply', confirmToken: tokenNow }, `apply (intento ${intento})`);
    const r = await waitCommand(applyId, { timeoutMs: 25 * 60 * 1000, pollMs: 20 * 1000 });
    if (r.status === 'applied' || r.status === 'applied_with_warnings') { applyResult = r; log(`apply APLICADO ✔ (intento ${intento}) → ${JSON.stringify(r)}`); break; }
    log(`apply intento ${intento} → ${r.status}: ${r.error_reason || ''}`);
    if (String(r.error_reason || '').includes('turno activo')) throw new Error('se abrió un turno; FASE 2 debe reintentarse otra noche');
    if (String(r.error_reason || '').includes('token no coincide')) throw new Error('nube movida; re-ejecutar el orquestador');
    if (intento === 8) throw new Error('apply agotó reintentos');
    await sleep(3.5 * 60 * 1000);
}

// ── PASO 6: backup final + verificación de espejo ──
log('encolando request_full_backup final…');
await enqueueRealFullBackup(monitor);
await sleep(4 * 60 * 1000);
const finalBk = await lastBackupAgeMinutes(monitor);
log(`backup final: hace ${finalBk === Infinity ? '∞' : finalBk.toFixed(1)} min`);

const finalDoc = await readDoc60(monitor);
const fsDoc = shiftState(finalDoc);
log('═══════════════ RESULTADO FASE 2 ═══════════════');
log(`Doc 60 canónico: ${fsDoc.total} registros | ${fsDoc.cierres} cierres | maxSale #${fsDoc.maxSale}`);
log('verificar en el backup final que bodega_sales_v1 local == Doc 60 (conteos y maxSale).');
log('FASE 2 COMPLETA ✔');

/** request_full_backup real (command_type puro — la constraint lo admite). */
async function enqueueRealFullBackup(monitorId) {
    const { data, error } = await sb
        .from('supervisor_commands')
        .insert({
            primary_device_id: DEVICE,
            monitor_device_id: monitorId,
            command_type: 'request_full_backup',
            status: 'pending',
            payload: { phase: 'fase2', reason: 'pre-apply safety net' },
        })
        .select('id')
        .single();
    if (error) throw new Error('INSERT request_full_backup: ' + error.message);
    log(`encolado request_full_backup: ${data.id}`);
    return data.id;
}
