#!/usr/bin/env node
/**
 * scripts/renumber-duplicates-doc60-12092026.mjs
 *
 * Renumera UN lado de cada par de `saleNumber` duplicado en el Doc 60 canónico
 * (12 pares detectados: #759–#763 y #809–#815 — ventas distintas que comparten
 * número por los truncados de historial del PC del 8-9/9-9 y del 12-09).
 *
 * REGLA: en cada par se conserva el número en la venta MÁS ANTIGUA
 * (createdAt||timestamp; desempate por id) y se renumera la(s) más reciente(s)
 * con números NUEVOS consecutivos (maxActual+1, +2, ...), asignados en orden
 * cronológico. NADA se borra; solo cambia saleNumber (+ trazabilidad).
 *
 * Garantías:
 *  - Snapshot previo en backups/ (red de rollback).
 *  - Los totales por cierre NO cambian: los registros siguen siendo los mismos,
 *    solo se reasigna su número de factura.
 *  - Trazabilidad: _renumberedFrom (número anterior), _renumberedAt, updatedAt.
 *
 * Uso:  node scripts/renumber-duplicates-doc60-12092026.mjs            (dry-run)
 *       APPLY=1 node scripts/renumber-duplicates-doc60-12092026.mjs    (aplicar)
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
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const APPLY = process.env.APPLY === '1';

// ── Leer Doc 60 ──
const r = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
if (!r.ok) { console.error('✗ lectura Doc 60:', r.status, (await r.text()).slice(0, 200)); process.exit(1); }
const doc = (await r.json())[0];
const sales = doc.data.payload || [];
console.log(`Doc 60: ${sales.length} registros, updated_at=${doc.updated_at}`);

// ── Snapshot previo (siempre, incluso en dry-run, por si hay que comparar) ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const snapPath = `backups/snapshot-doc60-pre-renumber-${stamp}.json`;
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync(snapPath, JSON.stringify({ savedAt: new Date().toISOString(), docUpdated: doc.updated_at, payload: sales }, null, 1));
console.log(`snapshot → ${snapPath}`);

// ── Detectar duplicados en tiempo de ejecución (fuente de verdad = la nube viva) ──
const ventas = sales.filter((s) => s && s.tipo === 'VENTA' && Number.isFinite(Number(s.saleNumber)) && Number(s.saleNumber) > 0);
const byNum = new Map();
for (const v of ventas) {
    const n = Number(v.saleNumber);
    if (!byNum.has(n)) byNum.set(n, []);
    byNum.get(n).push(v);
}
const dupGroups = [...byNum.entries()].filter(([, arr]) => arr.length > 1).sort((a, b) => a[0] - b[0]);
if (dupGroups.length === 0) {
    console.log('No hay saleNumbers duplicados. Nada que hacer.');
    process.exit(0);
}
console.log(`\npares duplicados detectados: ${dupGroups.length}`);
for (const [n, arr] of dupGroups) {
    console.log(`  #${n} × ${arr.length}: ${arr.map((v) => v.id.slice(-6)).join(', ')}`);
}

// ── Calcular el plan de renumeración ──
const orderKey = (v) => `${v.createdAt || v.timestamp || ''}|${v.id}`;
const maxActual = Math.max(...ventas.map((v) => Number(v.saleNumber)));
let nextNum = maxActual + 1;

const now = new Date().toISOString();
const next = sales.map((s) => ({ ...s }));
const byId = new Map(next.map((s) => [s.id, s]));
const plan = [];

for (const [n, arr] of dupGroups) {
    // Conservar el número en la MÁS ANTIGUA; renumerar el resto en orden cronológico.
    const sorted = [...arr].sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
    const keep = sorted[0];
    for (const v of sorted.slice(1)) {
        plan.push({ rec: byId.get(v.id), from: n, to: nextNum++ });
        void keep; // solo documental: el número se queda donde está
    }
}

console.log(`\nplan de renumeración (${plan.length} registros, nuevos números #${maxActual + 1}..#${nextNum - 1}):`);
for (const p of plan) {
    console.log(`  ${p.rec.id}  #${p.from} → #${p.to}  (createdAt=${p.rec.createdAt || p.rec.timestamp}, Bs ${p.rec.totalBs})`);
}

// ── Sanity: los números nuevos no deben existir ya ──
for (const p of plan) {
    if (byNum.has(p.to)) { console.error(`✗ ABORTA: #${p.to} ya existe`); process.exit(1); }
}

if (!APPLY) {
    console.log('\nDRY-RUN. Aplicar con APPLY=1');
    process.exit(0);
}

// ── Aplicar ──
for (const p of plan) {
    p.rec._renumberedFrom = p.from;
    p.rec.saleNumber = p.to; // ← el cambio real de número
    p.rec._renumberedAt = now;
    p.rec._nota = `Renumerada #${p.from}→#${p.to} (colisión de numeración por historial truncado del PC); venta intacta, sin cambios de montos`;
    p.rec.updatedAt = now;
}

const pr = await fetch(`${url}/rest/v1/sync_documents?id=eq.60`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ data: { payload: next }, updated_at: now }),
});
if (!pr.ok) {
    console.error(`✗ ERROR ${pr.status}: ${(await pr.text()).slice(0, 300)}`);
    process.exit(1);
}
console.log(`\n✓ Doc 60 renumerado (${plan.length} ventas, snapshot en ${snapPath})`);

// ── Verificación post-escritura (re-lectura fresca) ──
const r2 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
const doc2 = (await r2.json())[0];
const sales2 = doc2.data.payload || [];
const nums2 = sales2.filter((s) => s?.tipo === 'VENTA').map((s) => Number(s.saleNumber)).filter((n) => Number.isFinite(n) && n > 0);
const dups2 = nums2.filter((n, i) => nums2.indexOf(n) !== i);

const sum = (arr, f) => arr.reduce((a, s) => a + (Number(s?.[f]) || 0), 0);
const v1 = sales.filter((s) => s?.tipo === 'VENTA');
const v2 = sales2.filter((s) => s?.tipo === 'VENTA');
const sameIds = v1.length === v2.length && v1.every((x) => v2.some((y) => y.id === x.id));
const totalsSame = Math.abs(sum(v1, 'totalBs') - sum(v2, 'totalBs')) < 0.005
    && Math.abs(sum(v1, 'totalUsd') - sum(v2, 'totalUsd')) < 0.005;

const c1 = sales.filter((s) => s?.tipo === 'REGISTRO_CIERRE');
const c2 = sales2.filter((s) => s?.tipo === 'REGISTRO_CIERRE');
const cierresIntactos = c1.length === c2.length && c1.every((x) => {
    const y = c2.find((z) => z.id === x.id);
    return y && JSON.stringify(y.summary || {}) === JSON.stringify(x.summary || {});
});

console.log('\n═══ VERIFICACIÓN POST-RENUMBER ═══');
console.log(`registros: ${sales.length} → ${sales2.length} (debe ser igual)`);
console.log(`saleNumbers duplicados: ${dups2.length === 0 ? 'NINGUNO ✔' : 'QUEDAN: ' + dups2.join(',')}`);
console.log(`mismas ventas por id: ${sameIds ? 'SÍ ✔' : 'NO ✗'}`);
console.log(`totales Bs/$ idénticos: ${totalsSame ? 'SÍ ✔' : 'NO ✗'}`);
console.log(`cierres y summaries intactos: ${cierresIntactos ? 'SÍ ✔' : 'NO ✗'}`);
console.log(`nuevo max saleNumber: #${Math.max(...nums2)}`);
process.exit(dups2.length === 0 && sameIds && totalsSame && cierresIntactos ? 0 : 1);
