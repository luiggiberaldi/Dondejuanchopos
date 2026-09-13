#!/usr/bin/env node
/**
 * scripts/daily-sync-audit.mjs — FASE 4: auto-chequeo diario de sync.
 *
 * SOLO LECTURA. Verifica:
 *   1. Integridad del Doc 60: duplicados de saleNumber (globales y del día),
 *      max, ventas sin número, provisionales sin conciliar.
 *   2. PC vs nube: espejo del historial local (backup más reciente), edad del
 *      backup y divergencia de conteos (la señal del incidente de 15 h).
 *   3. Higiene de comandos: replace_sales_history pendientes >24 h, filas
 *      instance_gate (debe haber ≤1), reclamos sale_number_claim viejos.
 *
 * Uso:  node scripts/daily-sync-audit.mjs
 *       node scripts/daily-sync-audit.mjs --pedir-backup  (encola backup fresco antes de auditar)
 *
 * Exit: 0 = todo en orden · 1 = advertencias (útil para un cron/CI que avise).
 */
import fs from 'node:fs';

const ENV = {};
fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2];
});
const url = ENV.VITE_SUPABASE_URL || ENV.VITE_SUPABASE_CLOUD_URL;
const key = ENV.SUPABASE_SERVICE_KEY || ENV.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('✗ Falta .env'); process.exit(1); }
const H = { apikey: key, Authorization: `Bearer ${key}` };
const PRIMARY = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
const PEDIR = process.argv.includes('--pedir-backup');

const warnings = [];
const ok = (msg) => console.log('  ✔ ' + msg);
const warn = (msg) => { console.log('  ⚠ ' + msg); warnings.push(msg); };
const stats = (arr) => {
    const nums = arr.map((s) => Number(s && s.saleNumber)).filter((n) => Number.isFinite(n) && n > 0);
    const seen = new Map();
    for (const n of nums) seen.set(n, (seen.get(n) || 0) + 1);
    return {
        total: arr.length,
        max: Math.max(0, ...nums),
        dups: [...seen.entries()].filter(([, c]) => c > 1),
        sinNumero: arr.filter((s) => s && ['VENTA', 'VENTA_FIADA', 'COBRO_DEUDA'].includes(s.tipo) && !(Number(s.saleNumber) > 0)).length,
        provisionales: arr.filter((s) => s && s.saleNumberProvisional).length,
    };
};

console.log('═'.repeat(74));
console.log('AUDITORÍA DIARIA DE SYNC — ' + new Date().toISOString());
console.log('═'.repeat(74));

// ── (opcional) pedir backup fresco y esperar ──
if (PEDIR) {
    const r0 = await fetch(`${url}/rest/v1/supervisor_commands?status=eq.applied&select=monitor_device_id&limit=1`, { headers: H });
    const monitor = ((await r0.json())[0] || {}).monitor_device_id;
    await fetch(`${url}/rest/v1/supervisor_commands`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitor_device_id: monitor, primary_device_id: PRIMARY, command_type: 'request_full_backup', status: 'pending', payload: { requested_by: 'daily-sync-audit', motivo: 'auditoría diaria' } }),
    });
    console.log('backup fresco solicitado; esperando 75 s…');
    await new Promise((r) => setTimeout(r, 75_000));
}

// ── 1. Integridad del Doc 60 ──
const rd = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
const doc = (await rd.json())[0];
const cloud = doc.data.payload || [];
const cs = stats(cloud);
const hoy = new Date().toISOString().slice(0, 10);
const delDia = cloud.filter((s) => String(s.createdAt || s.timestamp || '').slice(0, 10) === hoy);
const ds = stats(delDia);

console.log('\n[1] DOC 60 (canónico):');
ok(`registros=${cs.total} · ventas+cobros+fiados con número · max=#${cs.max}`);
if (cs.dups.length === 0) ok('duplicados de saleNumber: 0');
else warn(`duplicados GLOBALES de saleNumber: ${cs.dups.length} → ${cs.dups.slice(0, 10).map(([n, c]) => '#' + n + '×' + c).join(', ')} (limpiar con scripts/renumber-duplicates-doc60-12092026.mjs)`);
if (cs.sinNumero === 0) ok('ningún registro de venta sin saleNumber');
else warn(`${cs.sinNumero} registros de venta SIN saleNumber`);
if (cs.provisionales === 0) ok('ninguna venta provisional pendiente de conciliar');
else {
    const prov = cloud.filter((s) => s && s.saleNumberProvisional);
    const provNums = prov.map((s) => Number(s.saleNumber));
    const provColisionan = provNums.filter((n) => cs.dups.some(([dn]) => dn === n));
    if (provColisionan.length === 0) ok(`${cs.provisionales} ventas provisionales (fallback offline) pero con números ÚNICOS en la nube — solo quedan como trazabilidad`);
    else warn(`${provColisionan.length} ventas provisionales COLISIONAN — renumerar`);
}
console.log(`      hoy: ${delDia.length} registros · max=#${ds.max} · dups=${ds.dups.length}`);

// ── 2. PC vs nube ──
console.log('\n[2] PC (último backup) vs DOC 60:');
const rb = await fetch(`${url}/rest/v1/cloud_backups?select=device_id,backup_data,updated_at,sales_count&order=updated_at.desc&limit=1`, { headers: H });
const bk = (await rb.json())[0];
const b = bk.backup_data || {};
const local = (b.data && b.data.idb && b.data.idb.bodega_sales_v1) || [];
const ls = stats(local);
const edadMin = Math.round((Date.now() - new Date(bk.updated_at).getTime()) / 60000);
console.log(`      backup: ${bk.updated_at} (hace ${edadMin} min) · instancia=${b.instanceId ? b.instanceId.slice(0, 8) + '…' : 'N/D'}`);
const delta = local.length - cloud.length;
if (local.length === cloud.length) ok(`espejo perfecto: local ${local.length} == nube ${cloud.length} · max local=#${ls.max}`);
else if (Math.abs(delta) <= 2 && edadMin <= 30) ok(`divergencia pequeña (${delta}) y backup fresco — push en curso, normal`);
else warn(`DIVERGENCIA: PC declara ${local.length} registros vs nube ${cloud.length} (delta=${delta}) · backup de hace ${edadMin} min · max local=#${ls.max} vs nube #${cs.max}`);
if (edadMin > 6 * 60) warn(`el backup del PC tiene ${Math.round(edadMin / 60)} h — ¿el PC está en línea?`);

// ── 3. Higiene de comandos ──
console.log('\n[3] Higiene de comandos:');
const rc = await fetch(`${url}/rest/v1/supervisor_commands?select=id,status,payload,created_at&order=created_at.desc&limit=50`, { headers: H });
const cmds = await rc.json();
const list = Array.isArray(cmds) ? cmds : [];
const pendRsh = list.filter((c) => (c.payload || {}).action === 'replace_sales_history' && c.status === 'pending');
const horasPend = pendRsh.length ? Math.round((Date.now() - new Date(pendRsh[0].created_at).getTime()) / 3600000) : 0;
if (pendRsh.length === 0) ok('sin replace_sales_history pendientes');
else if (horasPend <= 24) ok(`replace_sales_history armado y esperando cierre (${horasPend} h) — comportamiento normal`);
else warn(`replace_sales_history pendiente desde hace ${horasPend} h — ¿la caja cerró y no se aplicó?`);
const gates = list.filter((c) => (c.payload || {}).action === 'instance_gate');
if (gates.length <= 1) ok(`instance_gate: ${gates.length} fila (correcto)`);
else warn(`instance_gate: ${gates.length} filas (debe haber 1) — depurar duplicados`);
const claims = list.filter((c) => (c.payload || {}).action === 'sale_number_claim');
const claimsViejos = claims.filter((c) => Date.now() - new Date(c.created_at).getTime() > 24 * 3600 * 1000);
if (claims.length === 0) console.log('  ℹ sin filas sale_number_claim (las ventas recientes no usaron el allocator o aún no hay ventas)');
else if (claimsViejos.length === 0) ok(`${claims.length} reclamo(s) sale_number_claim reciente(s) del allocator — estado normal de coordinación (≤24 h)`);
else warn(`${claimsViejos.length} reclamos con >24 h — se pueden eliminar (${claims.length} totales)`);

// ── Veredicto ──
console.log('\n' + '═'.repeat(74));
if (warnings.length === 0) {
    console.log('RESULTADO: TODO EN ORDEN ✅');
} else {
    console.log(`RESULTADO: ${warnings.length} ADVERTENCIA(S) ⚠`);
    warnings.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
}
console.log('═'.repeat(74));
process.exit(warnings.length ? 1 : 0);
