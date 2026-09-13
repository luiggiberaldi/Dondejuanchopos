#!/usr/bin/env node
/**
 * scripts/verify-fase2-post-cierre.mjs
 *
 * Verificación post-cierre de FASE 2 (SOLO LECTURA — seguro en cualquier momento):
 *   1. Estado de las filas prepare/apply de replace_sales_history (por ID o las más recientes).
 *   2. Estado del turno en Doc 60 (¿cerró ya la caja?).
 *   3. Último backup del PC (instancia real, conteos, max saleNumber) vs Doc 60.
 *   4. Duplicados de saleNumber en Doc 60 (debe ser 0).
 *   5. Veredicto claro de qué falta.
 *
 * Uso:  node scripts/verify-fase2-post-cierre.mjs
 *       node scripts/verify-fase2-post-cierre.mjs --pedir-backup   (encola request_full_backup)
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

const stats = (arr) => {
    const nums = arr.map((s) => Number(s && s.saleNumber)).filter((n) => Number.isFinite(n) && n > 0);
    const seen = new Map();
    for (const n of nums) seen.set(n, (seen.get(n) || 0) + 1);
    const dups = [...seen.entries()].filter(([, c]) => c > 1);
    const orden = [...arr].sort((a, b) => String(b.timestamp || b.createdAt || '').localeCompare(String(a.timestamp || a.createdAt || '')));
    return {
        total: arr.length,
        cierres: arr.filter((s) => s && s.tipo === 'REGISTRO_CIERRE').length,
        aperturas: arr.filter((s) => s && s.tipo === 'APERTURA_CAJA').length,
        max: Math.max(0, ...nums),
        dups,
        ultimo: orden[0] ? `${orden[0].tipo}@${orden[0].timestamp || orden[0].createdAt}` : 'N/D',
    };
};

console.log('═'.repeat(74));
console.log('VERIFICACIÓN POST-CIERRE — FASE 2 (replace_sales_history)');
console.log('Ahora:', new Date().toISOString(), `(local ≈ UTC-4)`);
console.log('═'.repeat(74));

// ── 1. Filas de comando ──
const rc = await fetch(`${url}/rest/v1/supervisor_commands?payload->>action=eq.replace_sales_history&select=id,status,payload,created_at&order=created_at.desc&limit=12`, { headers: H });
const rows = Array.isArray(await rc.clone().json()) ? await rc.json() : [];
const all = Array.isArray(rows) ? rows : [];
const prepare = all.find((x) => (x.payload || {}).phase === 'prepare' && x.status === 'pending') || all.find((x) => (x.payload || {}).phase === 'prepare');
const applyRow = all.find((x) => (x.payload || {}).phase === 'apply' && x.status === 'pending') || all.find((x) => (x.payload || {}).phase === 'apply');
console.log('\n[1] Filas replace_sales_history (las armadas + más recientes):');
for (const x of all.slice(0, 6)) {
    console.log(`    ${x.id.slice(0, 8)} | ${(x.payload || {}).phase} | ${x.status} | ${x.created_at}`);
}
console.log(`\n    prepare (${prepare ? prepare.id.slice(0, 8) : '?'}): ${prepare ? prepare.status : 'NO ENCONTRADA'}`);
console.log(`    apply   (${applyRow ? applyRow.id.slice(0, 8) : '?'}): ${applyRow ? applyRow.status : 'NO ENCONTRADA'}`);
const ambosAplicados = prepare?.status === 'applied' && applyRow?.status === 'applied';

// ── 2. Doc 60 y estado del turno ──
const rd = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
const doc = (await rd.json())[0];
const cloud = doc.data.payload || [];
const cs = stats(cloud);
console.log(`\n[2] DOC 60: registros=${cs.total} | cierres=${cs.cierres} | aperturas=${cs.aperturas} | max=#${cs.max} | duplicados=${cs.dups.length}${cs.dups.length ? ' → ' + cs.dups.slice(0, 6).map(([n, c]) => '#' + n + '×' + c).join(', ') : ' ✔'}`);
console.log(`    último registro: ${cs.ultimo} | updated_at=${doc.updated_at}`);
const turnoCerrado = cs.cierres > cs.aperturas;
console.log(`    ¿caja cerrada? ${turnoCerrado ? 'SÍ (cierres > aperturas)' : 'NO — sigue abierta (el par espera por diseño)'}`);

// ── 3. Último backup del PC ──
console.log('\n[3] Último backup del PC vs Doc 60:');
if (PEDIR) {
    const r0 = await fetch(`${url}/rest/v1/supervisor_commands?status=eq.applied&select=monitor_device_id&limit=1`, { headers: H });
    const monitor = ((await r0.json())[0] || {}).monitor_device_id;
    const ins = await fetch(`${url}/rest/v1/supervisor_commands`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ monitor_device_id: monitor, primary_device_id: PRIMARY, command_type: 'request_full_backup', status: 'pending', payload: { requested_by: 'verify-fase2-post-cierre', motivo: 'verificación de reconstrucción' } }),
    });
    console.log('    → request_full_backup encolado:', ins.status);
    console.log('    → espera ~60-90 s y vuelve a ejecutar este script (sin --pedir-backup).');
    process.exit(0);
}
const rb = await fetch(`${url}/rest/v1/cloud_backups?select=device_id,backup_data,updated_at&order=updated_at.desc&limit=1`, { headers: H });
const bk = (await rb.json())[0];
const b = bk.backup_data || {};
const local = (b.data && b.data.idb && b.data.idb.bodega_sales_v1) || [];
const ls = stats(local);
const instanciaReal = b.instanceId === '6630e805-b683-4d13-9ed3-3996ebc1ee63';
console.log(`    backup: ${bk.updated_at} | instanceId=${b.instanceId || 'N/D'} ${instanciaReal ? '(PC REAL ✔)' : '⚠ ¡no es la instancia registrada!'}`);
console.log(`    local:  registros=${ls.total} | cierres=${ls.cierres} | max=#${ls.max} | dups=${ls.dups.length}`);
console.log(`    espejo (local == Doc 60): ${ls.total === cs.total && ls.cierres === cs.cierres && ls.max >= cs.max ? 'SÍ ✔' : 'AÚN NO (esperado hasta que apply ejecute)'}`);

// ── 4. Veredicto ──
console.log('\n' + '═'.repeat(74));
console.log('VEREDICTO:');
if (!ambosAplicados) {
    console.log(turnoCerrado
        ? '  ⚠ La caja YA cerró pero las filas siguen sin aplicar → revisar en ~15 min (SW refresh) o re-encolar.'
        : '  ⏳ La caja sigue ABIERTA — el par deferred espera el cierre (comportamiento correcto).');
    console.log('  Vuelve a ejecutar este script después del cierre (~00:30 local / 04:30 UTC).');
} else if (ls.total === cs.total && ls.max >= cs.max && cs.dups.length === 0) {
    console.log('  ✅ FASE 2 COMPLETA: prepare/apply aplicados, historial local del PC espeja Doc 60, 0 duplicados.');
} else {
    console.log('  ⚠ Comandos aplicados PERO la reconstrucción no cuadra — inspeccionar el reporte de apply.');
}
console.log('═'.repeat(74));
