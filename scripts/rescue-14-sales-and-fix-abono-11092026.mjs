#!/usr/bin/env node
/**
 * scripts/rescue-14-sales-and-fix-abono-11092026.mjs
 *  A) Inserta en Doc 60 las 14 ventas del PC (12-09) que solo existen localmente,
 *     renumeradas siguiendo el máximo del Doc (con _originalSaleNumber y _nota).
 *  B) Reclasifica el COBRO_DEUDA de ramon (5eb6d6bd) como pago_movil (el dueño lo
 *     recibió por pago móvil): NO suma efectivo a la gaveta.
 * Snapshot de rollback primero. DRY-RUN por defecto (APPLY=1).
 */
import fs from 'node:fs';
import path from 'node:path';

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
const G = { apikey: key, Authorization: `Bearer ${key}` };
const APPLY = process.env.APPLY === '1';
const now = new Date().toISOString();

const bk = JSON.parse(fs.readFileSync('backups/pc-local-backup-live.json', 'utf8'));
const pcSales = bk.data?.idb?.bodega_sales_v1 || [];

const COBRO_ID = '5eb6d6bd-1fd3-4f87-824a-ba2855524b73';

const r60 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: G });
const d60 = (await r60.json())[0];
const sales = d60.data.payload || [];
const byId = new Map(sales.map(s => [s.id, s]));
const existingIds = new Set(sales.map(s => s.id));

// ── A) ventas del PC (post 2026-09-12T00:00Z) que falten ──
const faltantes = pcSales
    .filter(s => s?.tipo === 'VENTA' && (s.timestamp || '') >= '2026-09-12')
    .filter(s => !existingIds.has(s.id))
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
let renum = Math.max(...sales.map(s => s.saleNumber || 0), 0);
const insertar = faltantes.map(v => {
    renum += 1;
    return {
        ...v,
        saleNumber: renum,
        _originalSaleNumber: v.saleNumber,
        _nota: `Rescatada del respaldo local del PC (12-09); renumerada desde #${v.saleNumber} por colisión con numeración de comandos`,
        updatedAt: now,
    };
});
console.log(`A) Ventas del PC a insertar: ${insertar.length} (suman ${insertar.reduce((a, v) => a + (v.totalBs || 0), 0)} Bs / $${Math.round(insertar.reduce((a, v) => a + (v.totalUsd || 0), 0) * 100) / 100})`);
console.log('   renumeración:', insertar.map(v => `#${v._originalSaleNumber}→#${v.saleNumber}`).join(', '));

// ── B) cobro de ramon → pago_movil ──
const cobro = byId.get(COBRO_ID);
let cobroNuevo = null;
if (cobro) {
    cobroNuevo = {
        ...cobro,
        paymentMethod: 'pago_movil',
        payments: [{
            methodId: 'pago_movil', amount: 20000, currency: 'BS',
            amountUsd: 21.28, amountBs: 20000, methodLabel: 'Pago Móvil',
        }],
        nota: (cobro.nota || '') + ' | CORREGIDO: el dueño lo recibió por PAGO MÓVIL — no suma efectivo a gaveta',
        _corregido: { en: now, antes: 'efectivo_bs', motivo: 'pago recibido por el dueño vía pago móvil' },
    };
    console.log('B) Cobro de ramon presente en Doc60 → se reclasifica a pago_movil');
} else {
    console.log('B) Cobro de ramon NO está en Doc60 (nada que corregir)');
}

// ── Proyección ──
const next = sales.map(s => (s.id === COBRO_ID ? cobroNuevo : s));
for (const item of insertar) { if (!byId.has(item.id)) { next.push(item); byId.set(item.id, item); } }
const movs = next.filter(s => ['VENTA', 'COBRO_DEUDA', 'VENTA_FIADA'].includes(s.tipo) && new Date(s.timestamp).getTime() >= new Date('2026-09-11T16:59:01.287Z').getTime());
let efbs = 0, efusd = 0, ventasBs = 0, nVentas = 0;
for (const m of movs) {
    if (m.tipo === 'VENTA') { nVentas++; ventasBs += m.totalBs || 0; }
    for (const p of (m.payments || [{ methodId: m.paymentMethod, amountBs: m.totalBs, amountUsd: m.totalUsd }])) {
        if (p?.methodId === 'efectivo_bs') efbs += p.amountBs ?? 0;
        if (p?.methodId === 'efectivo_usd') efusd += p.amountUsd ?? 0;
    }
}
console.log(`\nProyección turno activo: ${nVentas} ventas | ${ventasBs} Bs vendidos`);
console.log(`Gaveta esperada tras cirugía: ${8410 + efbs} Bs / $${Math.round((33 + efusd) * 100) / 100}`);
console.log(`Registros Doc60: ${sales.length} → ${next.length}`);
if (!APPLY) { console.log('\nDRY-RUN. Aplicar con APPLY=1'); process.exit(0); }

fs.writeFileSync('backups/snapshot-doc60-pre-rescate14.json', JSON.stringify({ updated_at: d60.updated_at, payload: sales }));
const p = await fetch(`${url}/rest/v1/sync_documents?id=eq.60`, { method: 'PATCH', headers: H, body: JSON.stringify({ data: { payload: next }, updated_at: now }) });
console.log('\nDoc60 PATCH:', p.status, p.ok ? `(${next.length} registros)` : await p.text());
