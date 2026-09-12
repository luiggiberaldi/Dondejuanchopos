#!/usr/bin/env node
/**
 * scripts/activate-sales-merge-12092026.mjs
 *
 * FASE 1 del plan maestro: activa el flag `dj_sales_push_merge_v1` en la caja
 * de producción vía comando de supervisor (envelope inventory_update +
 * action=enable_feature, único admitido por la constraint viva de la tabla).
 *
 * Uso:
 *   node scripts/activate-sales-merge-12092026.mjs          # encolar y verificar
 *   ACTIVAR=1 node scripts/activate-sales-merge-12092026.mjs # encolar de verdad
 *
 * Tras activar, espera el polling (12s) del catch-up de comandos y verifica:
 *   1) status del comando (applied / failed+reason)
 *   2) conteo del Doc 60 (¿el push fusionado del PC llegó?)
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
const FLAG = 'dj_sales_push_merge_v1';

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(CLOUD_URL, CLOUD_KEY);

async function getMonitorId() {
    const { data, error } = await sb
        .from('device_pairings')
        .select('monitor_device_id')
        .eq('primary_device_id', DEVICE)
        .maybeSingle();
    if (error || !data?.monitor_device_id) throw new Error('Sin pairing para la caja: ' + (error?.message || 'vacío'));
    return data.monitor_device_id;
}

async function doc60Stats() {
    const monitor = await getMonitorId();
    const { data, error } = await sb.rpc('read_paired_audit_documents', {
        p_primary_device_id: DEVICE,
        p_monitor_device_id: monitor,
        p_doc_ids: ['bodega_sales_v1'],
    });
    if (error) throw new Error('RPC lectura Doc 60: ' + error.message);
    const payload = data?.[0]?.data?.payload;
    if (!Array.isArray(payload)) throw new Error('Doc 60 sin payload');
    return {
        total: payload.length,
        cierres: payload.filter((s) => s?.tipo === 'REGISTRO_CIERRE').length,
        ventasHoy: payload.filter((s) => s?.tipo === 'VENTA' && String(s?.timestamp || '').startsWith('2026-09-12')).length,
        updated_at: data[0]?.updated_at,
    };
}

const APPLY = process.env.ACTIVAR === '1';

console.log('═'.repeat(70));
console.log('ACTIVACIÓN MERGE-ON-PUSH (FASE 1) — flag:', FLAG);
console.log('═'.repeat(70));

const before = await doc60Stats();
console.log('Doc 60 ANTES :', JSON.stringify(before));

if (!APPLY) {
    console.log('\n[DRY-RUN] Se encolaría enable_feature con payload:');
    console.log(JSON.stringify({ action: 'enable_feature', flag: FLAG }, null, 2));
    console.log('\nEjecuta con ACTIVAR=1 para encolar de verdad.');
    process.exit(0);
}

// Idempotencia: si ya hay un comando applied reciente con este flag, no duplicar.
const monitor = await getMonitorId();
const { data: recent } = await sb
    .from('supervisor_commands')
    .select('id,status,payload,created_at')
    .eq('primary_device_id', DEVICE)
    .eq('command_type', 'inventory_update')
    .order('created_at', { ascending: false })
    .limit(30);
const dup = (recent || []).find(
    (c) => c?.payload?.action === 'enable_feature' && c?.payload?.flag === FLAG && c.status === 'applied',
);
if (dup) {
    console.log(`Ya existe enable_feature applied (${dup.id} @ ${dup.created_at}). No se duplica.`);
    console.log('Si necesitas reactivar, usa action=disable y luego enable.');
    process.exit(0);
}

const { data: cmd, error } = await sb
    .from('supervisor_commands')
    .insert({
        primary_device_id: DEVICE,
        monitor_device_id: monitor,
        command_type: 'inventory_update',
        status: 'pending',
        payload: { action: 'enable_feature', flag: FLAG },
    })
    .select('id')
    .single();
if (error) throw new Error('INSERT comando: ' + error.message);
console.log('Comando encolado:', cmd.id);

// Esperar a que el catch-up (12s) lo procese y el push post-enable llegue.
console.log('Esperando 90s (polling 12s + push fusionado)...');
await new Promise((r) => setTimeout(r, 90000));

const { data: done } = await sb
    .from('supervisor_commands')
    .select('status,error_reason,applied_at')
    .eq('id', cmd.id)
    .single();
console.log('Estado del comando:', JSON.stringify(done));

const after = await doc60Stats();
console.log('Doc 60 DESPUÉS:', JSON.stringify(after));

if (done?.status === 'applied' && after.total >= before.total) {
    console.log('\n✅ FASE 1 ACTIVA: la caja fusiona su push con el Doc 60 canónico.');
} else if (done?.status === 'failed') {
    console.log('\n⚠️ La caja rechazó el comando:', done.error_reason);
    console.log('   Casi seguro: Service Worker viejo aún activo. Reintenta en ~10 min:');
    console.log('   ACTIVAR=1 node scripts/activate-sales-merge-12092026.mjs');
} else {
    console.log('\n⏳ Sin confirmación aún. Reintenta el paso de verificación más tarde.');
}
