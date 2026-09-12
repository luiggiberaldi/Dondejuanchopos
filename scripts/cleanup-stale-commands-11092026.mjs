#!/usr/bin/env node
/**
 * scripts/cleanup-stale-commands-11092026.mjs
 *
 * Limpieza QUIRÚRGICA de supervisor_commands para el dispositivo autoritativo.
 * NO toca sync_documents (ni ventas, ni clientes). Solo cambia el estado de
 * comandos obsoletos para que la caja no los aplique tarde:
 *
 *   - Cancela los 6 `update_customer_balance` pendientes de AGOSTO
 *     (pondrían en 0 saldos de CLI-00008/09/12/13 si se aplicaran tarde).
 *   - Cancela `81076563…` (CLI-00011 con deuda 10.71, SUPERADO por d0a94c27 = 14.08).
 *   - MANTIENE `d0a94c27…` (CLI-00011 → deuda 14.08, favor 0) como pending:
 *     es el comando autoritativo que la caja debe aplicar al recargar.
 *
 * DRY-RUN por defecto:  node scripts/cleanup-stale-commands-11092026.mjs
 * Aplicar:              APPLY=1 node scripts/cleanup-stale-commands-11092026.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const DEVICE_ID = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
const CANCEL_PREFIXES = [
    '84b23ef2', 'd1f84deb', '5b2aade5', '6c6063d7', // 23-08: CLI-00012/13/08/09 a 0
    '81076563', // 11-09 14:34: CLI-00011 10.71 (superado por d0a94c27)
    '9df089e4', // 10-09 19:04: register_expense teipe — YA está en la jornada canónica; aplicarlo duplicaría -1.700 Bs
];
const KEEP_PENDING = 'd0a94c27';
const REASON = 'CANCELADO_MANUAL: comando obsoleto; los saldos se gestionan con el comando autoritativo vigente.';

function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return {};
    const env = {};
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const i = t.indexOf('=');
        if (i > -1) env[t.substring(0, i).trim()] = t.substring(i + 1).trim().replace(/^['"]|['"]$/g, '');
    });
    return env;
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_CLOUD_URL;
const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('✗ Falta .env'); process.exit(1); }
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const APPLY = process.env.APPLY === '1';

const res = await fetch(`${url}/rest/v1/supervisor_commands?primary_device_id=eq.${DEVICE_ID}&status=eq.pending&select=id,command_type,status,created_at,payload`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
const pendings = res.ok ? await res.json() : [];
console.log(`Comandos pending actuales: ${pendings.length}`);
pendings.forEach(c => console.log(`  • ${c.id.slice(0, 8)}… ${c.command_type} acción=${c.payload?.action || '—'} creado=${c.created_at}`));

const toCancel = pendings.filter(c =>
    CANCEL_PREFIXES.some(p => c.id.startsWith(p))
    || (c.payload?.action === 'update_customer_balance' && !c.id.startsWith(KEEP_PENDING) && c.created_at < '2026-09-11T14:40')
);

console.log(`\nA cancelar (${toCancel.length}):`);
toCancel.forEach(c => console.log(`  • ${c.id} (${c.payload?.action}, creado=${c.created_at})`));
const kept = pendings.filter(c => !toCancel.includes(c));
console.log(`Se mantienen pending (${kept.length}):`);
kept.forEach(c => console.log(`  • ${c.id} (${c.payload?.action || c.command_type})`));

if (!APPLY) {
    console.log('\nDRY-RUN. Para aplicar:  APPLY=1 node scripts/cleanup-stale-commands-11092026.mjs');
    process.exit(0);
}

for (const c of toCancel) {
    const r = await fetch(`${url}/rest/v1/supervisor_commands?id=eq.${c.id}`, {
        method: 'PATCH',
        headers: H,
        body: JSON.stringify({ status: 'failed', error_reason: REASON })
    });
    console.log(`${r.ok ? '✓ cancelado' : '✗ ERROR ' + r.status}: ${c.id}`);
}
console.log('\nListo. d0a94c27 (CLI-00011 → 14.08) sigue pendiente para que la caja lo aplique al recargar.');
process.exit(0);
