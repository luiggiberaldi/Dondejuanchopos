#!/usr/bin/env node
/**
 * scripts/watch-fase2-noche-1309.mjs
 *
 * Vigilante nocturno de FASE 2 (solo lectura + escritura de log): cada 2 minutos
 * revisa si la caja cerró (cierres > aperturas en Doc 60). Al cerrar:
 *   - espera a que prepare/apply pasen a 'applied' (hasta 60 min),
 *   - espera un backup del PC posterior al cierre,
 *   - compara espejo (conteos/cierres/max) y duplicados,
 *   - escribe el VEREDICTO en logs/verificacion-nocturna.log y termina.
 * Si a las 08:00 UTC no cerró, deja la nota y termina.
 */
import fs from 'node:fs';

const ENV = {};
fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2];
});
const url = ENV.VITE_SUPABASE_URL, key = ENV.SUPABASE_SERVICE_KEY || ENV.VITE_SUPABASE_ANON_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const L = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.mkdirSync('logs', { recursive: true });
    fs.appendFileSync('logs/verificacion-nocturna.log', line + '\n');
};
const stats = (arr) => {
    const nums = arr.map((s) => Number(s && s.saleNumber)).filter((n) => Number.isFinite(n) && n > 0);
    const seen = new Map();
    for (const n of nums) seen.set(n, (seen.get(n) || 0) + 1);
    return {
        total: arr.length,
        cierres: arr.filter((s) => s && s.tipo === 'REGISTRO_CIERRE').length,
        aperturas: arr.filter((s) => s && s.tipo === 'APERTURA_CAJA').length,
        max: Math.max(0, ...nums),
        dups: [...seen.entries()].filter(([, c]) => c > 1),
    };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

L('Vigilante nocturno FASE 2 iniciado (poll cada 2 min, límite 08:00 UTC).');

let cerró = false;
while (Date.now() < Date.parse('2026-09-13T08:00:00Z')) {
    const rd = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
    const doc = (await rd.json())[0];
    const cs = stats(doc.data.payload || []);
    if (cs.cierres > cs.aperturas) { cerró = true; L(`CAJA CERRADA detectada (cierres=${cs.cierres} > aperturas=${cs.aperturas}). Esperando ejecución de prepare/apply…`); break; }
    await sleep(120_000);
}
if (!cerró) { L('08:00 UTC sin cierre — el par sigue armado para la siguiente noche. Terminando.'); process.exit(0); }

let preparado = false, aplicado = false, applyInfo = '';
for (let i = 0; i < 30; i++) { // hasta 60 min
    await sleep(120_000);
    const rc = await fetch(`${url}/rest/v1/supervisor_commands?payload->>action=eq.replace_sales_history&select=id,status,payload&order=created_at.desc&limit=8`, { headers: H });
    const rows = await rc.json();
    const prep = (Array.isArray(rows) ? rows : []).find((x) => (x.payload || {}).phase === 'prepare' && x.id.startsWith('324509bd'));
    const app = (Array.isArray(rows) ? rows : []).find((x) => (x.payload || {}).phase === 'apply' && x.id.startsWith('7aa18828'));
    preparado = prep?.status === 'applied';
    aplicado = app?.status === 'applied' || app?.status === 'applied_with_warnings';
    if (prep) L(`prepare=${prep.status} apply=${app?.status}`);
    if (aplicado) { applyInfo = JSON.stringify(app?.payload || {}).slice(0, 400); break; }
    if (prep?.status === 'failed' || app?.status === 'failed') { L(`FALLO: prepare=${prep?.status} apply=${app?.status} — revisar error_reason en supervisor_commands.`); break; }
}

// Esperar backup del PC posterior al cierre y comparar
let espejo = null;
for (let i = 0; i < 20; i++) {
    await sleep(60_000);
    const rb = await fetch(`${url}/rest/v1/cloud_backups?select=backup_data,updated_at&order=updated_at.desc&limit=1`, { headers: H });
    const bk = (await rb.json())[0];
    const b = bk.backup_data || {};
    const local = (b.data && b.data.idb && b.data.idb.bodega_sales_v1) || [];
    const ls = stats(local);
    const rd = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data`, { headers: H });
    const cs = stats((await rd.json())[0].data.payload || []);
    L(`backup ${bk.updated_at}: local=${ls.total} (cierres=${ls.cierres}, max=#${ls.max}) vs nube=${cs.total} (max=#${cs.max}, dups=${cs.dups.length})`);
    if (ls.total === cs.total) { espejo = { ...ls, nube: cs }; break; }
}

if (espejo) {
    L(`VEREDICTO: ✅ FASE 2 COMPLETA — historial del PC ESPEJA Doc 60 (${espejo.total} registros, cierres=${espejo.cierres}, max=#${espejo.max}), duplicados en nube=${espejo.nube.dups.length}.`);
} else {
    L(`VEREDICTO: ⚠ apply=${aplicado ? 'aplicado' : 'pendiente/falló'} pero el espejo no se confirmó en 20 min. ${applyInfo}`);
}
