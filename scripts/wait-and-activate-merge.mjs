#!/usr/bin/env node
/**
 * scripts/wait-and-activate-merge.mjs
 *
 * Bucle resiliente para activar el merge-on-push (FASE 1) en la caja de
 * producción cuando vuelva a estar en línea:
 *   - Cada 3.5 min verifica el estado del último comando enable_feature.
 *   - pending   → sigue esperando (la caja procesará al reabrir).
 *   - failed por "Acción inválida" (SW viejo) → re-encola y sigue.
 *   - applied   → verifica el push fusionado en el Doc 60 y termina OK.
 *
 * Uso:  node scripts/wait-and-activate-merge.mjs   (máx ~3 h; sale antes si OK)
 */

import fs from 'node:fs';

const ENV = {};
fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2];
});

const DEVICE = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
const FLAG = 'dj_sales_push_merge_v1';
const INTERVAL_MS = 210000; // 3.5 min
const MAX_ATTEMPTS = 50; // ~3 h

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(ENV.VITE_SUPABASE_CLOUD_URL, ENV.VITE_SUPABASE_CLOUD_KEY);

async function getMonitorId() {
    const { data } = await sb.from('device_pairings').select('monitor_device_id')
        .eq('primary_device_id', DEVICE).maybeSingle();
    return data?.monitor_device_id || null;
}

async function doc60() {
    const monitor = await getMonitorId();
    const { data } = await sb.rpc('read_paired_audit_documents', {
        p_primary_device_id: DEVICE,
        p_monitor_device_id: monitor,
        p_doc_ids: ['bodega_sales_v1'],
    });
    const payload = data?.[0]?.data?.payload;
    return Array.isArray(payload)
        ? { total: payload.length, cierres: payload.filter((s) => s?.tipo === 'REGISTRO_CIERRE').length }
        : null;
}

async function enqueue() {
    const monitor = await getMonitorId();
    const { data, error } = await sb.from('supervisor_commands').insert({
        primary_device_id: DEVICE,
        monitor_device_id: monitor,
        command_type: 'inventory_update',
        status: 'pending',
        payload: { action: 'enable_feature', flag: FLAG },
    }).select('id').single();
    if (error) throw new Error('INSERT: ' + error.message);
    return data.id;
}

console.log(`[wait-merge] iniciando bucle (intervalo ${INTERVAL_MS / 1000}s, máx ${MAX_ATTEMPTS} intentos)`);

let currentCmdId = null;
for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    try {
        const { data: latest } = await sb.from('supervisor_commands')
            .select('id,status,error_reason,payload,applied_at')
            .eq('primary_device_id', DEVICE)
            .eq('command_type', 'inventory_update')
            .order('created_at', { ascending: false })
            .limit(10);

        const mine = (latest || []).filter((c) => c?.payload?.action === 'enable_feature' && c?.payload?.flag === FLAG);
        const applied = mine.find((c) => c.status === 'applied');
        const pending = mine.find((c) => c.status === 'pending');

        if (applied && (!currentCmdId || applied.id === currentCmdId || applied.applied_at)) {
            const d = await doc60();
            console.log(`[wait-merge] ✅ enable_feature aplicado (${applied.id} @ ${applied.applied_at}). Doc 60: ${JSON.stringify(d)}`);
            console.log('[wait-merge] FASE 1 ACTIVA en la caja. Fin.');
            process.exit(0);
        }

        if (pending) {
            currentCmdId = pending.id;
            console.log(`[wait-merge] intento ${i}: comando ${pending.id} sigue pending (caja offline o SW viejo). Esperando...`);
        } else {
            // Todos fallaron (típico: "Acción inválida" con SW viejo) o no hay: re-encolar.
            const id = await enqueue();
            currentCmdId = id;
            console.log(`[wait-merge] intento ${i}: re-encolado enable_feature ${id}`);
        }
    } catch (e) {
        console.warn(`[wait-merge] intento ${i}: error transitorio: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
console.log('[wait-merge] ⏱️ Tiempo agotado sin confirmar. Revisar manualmente con scripts/activate-sales-merge-12092026.mjs');
process.exit(1);
