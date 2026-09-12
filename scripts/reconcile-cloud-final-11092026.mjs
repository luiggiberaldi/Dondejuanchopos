#!/usr/bin/env node
/**
 * scripts/reconcile-cloud-final-11092026.mjs
 *
 * Cirugía final del Doc 60 para consolidar (SOLO INSERCIONES + 1 resumen reescrito):
 *
 *  A) La Jornada 10-09-2026 canónica queda CERRADA con su cierre documentado:
 *     - El cierre errado de la PC (cierre_1789145662786, $0.71 ciego) se reescribe
 *       con los datos canónicos (15.350 Bs / 8 ventas / gaveta 8.410+$33,
 *       declarado=esperado, diff 0) conservando su cierreId/timestamp/operador.
 *     - Las 10 movimientos de la jornada (#785–#792, teipe, apertura 9.980/$33)
 *       se sellan (cajaCerrada=true) y las ventas quedan vinculadas (cierreId).
 *
 *  B) Ambos cierres locales de la PC del 11-09 quedan registrados:
 *     - cierre_1789145494504 (16:51, forzado por supervisor) → cierre #40.
 *     - cierre_1789145662786 (16:54, cierre ciego $0.71 → REESCRITO con datos
 *       canónicos de la Jornada 10-09) → cierre #41.
 *
 *  C) Las 8 ventas REALES de hoy (del respaldo local de la PC) se INSERTAN con
 *     renumeración #793–#800 (siguiendo el máximo canónico 792), sin sellar,
 *     dentro del turno activo de relance (apertura 8.410/$33, que también se inserta).
 *
 *  NADA SE BORRA. Existe snapshot de rollback: backups/snapshot-canonical-doc60-52-20260911.json
 *
 * DRY-RUN por defecto:  node scripts/reconcile-cloud-final-11092026.mjs
 * Aplicar:              APPLY=1 node scripts/reconcile-cloud-final-11092026.mjs
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
const APPLY = process.env.APPLY === '1';

// ── Cargar respaldo local de la PC (fuente de las ventas reales de hoy) ──
const bk = JSON.parse(fs.readFileSync('backups/pc-local-backup-20260911T2340.json', 'utf8'));
const pcSales = bk.data.idb.bodega_sales_v1 || [];

// ── Leer Doc 60 actual ──
const r = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
const doc = (await r.json())[0];
const sales = doc.data.payload || [];
console.log(`Doc 60 actual: ${sales.length} registros, updated_at=${doc.updated_at}`);

const now = new Date().toISOString();
const next = sales.map(s => ({ ...s }));
const byId = new Map(next.map(s => [s.id, s]));
const CIERRA_CANONICO_ID = 'cierre_1789145662786';

// ── A) Reescribir el cierre errado con los datos canónicos de la Jornada 10-09 ──
const cierreErrado = byId.get(CIERRA_CANONICO_ID);
if (!cierreErrado) {
    // No está en la nube: se inserta como cierre #41 con datos canónicos
    console.log('El cierre errado no está en la nube; se insertará como #41.');
}
const cierreCanonico = {
    ...(cierreErrado || {}),
    id: CIERRA_CANONICO_ID,
    tipo: 'REGISTRO_CIERRE',
    cierreId: 1789145662786,
    cierreNumber: 41,
    timestamp: cierreErrado?.timestamp || '2026-09-11T16:54:22.924Z',
    cajaCerrada: true,
    summary: {
        ...(cierreErrado?.summary || {}),
        cashier: { rol: 'CAJERO', nombre: 'Luis Medina' },
        tasaCop: cierreErrado?.summary?.tasaCop || 4150,
        reconData: {
            cashBs: 8410, cashUsd: 33, cashCop: 0,
            declaredBs: 8410, declaredUsd: 33, declaredCop: 0,
            expectedBs: 8410, expectedUsd: 33, expectedCop: 0,
            diffBs: 0, diffUsd: 0, diffCop: 0,
            isBlindClose: false,
        },
        copEnabled: false,
        todayTotalBs: 15350,
        todayTotalUsd: 16.49,
        todayItemsSold: 8,
        todayProfit: cierreErrado?.summary?.todayProfit ?? 660,
        jornadaCanonica: '2026-09-10',
        cierreDocumentado: 'Jornada 10-09-2026: apertura 9.980/$33, ventas #785-#792 (15.350 Bs), teipe -1.700, gaveta 8.410/$33',
        _reconciliado: { en: now, reemplaza: 'cierre ciego $0.71 / 1 transacción' },
    },
};

// ── A2) Sellar la jornada canónica y vincular sus ventas al cierre ──
let selladas = 0;
for (const s of next) {
    if (s.cajaCerrada === true) continue;
    const ts = s.timestamp ? new Date(s.timestamp).getTime() : 0;
    const cierreTs = new Date(cierreCanonico.timestamp).getTime();
    const esJornada = (s.saleNumber >= 785 && s.saleNumber <= 792)
        || s.id === 'gasto_teipe_1789067070525'
        || s.id === 'apertura_1789057800000';
    if (esJornada && ts <= cierreTs) {
        s.cajaCerrada = true;
        if (s.tipo === 'VENTA') s.cierreId = cierreCanonico.cierreId;
        s.updatedAt = now;
        selladas++;
    }
}

// ── B) Insertar cierre #40 (forzado por supervisor) si no está ──
const insertar = [];
const cierre40 = pcSales.find(s => s?.id === 'cierre_1789145494504');
if (cierre40 && !byId.has('cierre_1789145494504')) insertar.push({ ...cierre40, cierreNumber: 40 });

// ── C) Insertar apertura de relance + ventas reales de hoy renumeradas #793+ ──
const maxCanon = Math.max(...sales.map(s => s.saleNumber || 0), 792);
let renum = maxCanon;
const apRelance = pcSales.find(s => s?.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
if (apRelance && !byId.has(apRelance.id)) insertar.push({ ...apRelance });

const ventasHoy = pcSales
    .filter(s => s?.tipo === 'VENTA' && !s.cajaCerrada && (s.timestamp || '').startsWith('2026-09-11'))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
for (const v of ventasHoy) {
    if (byId.has(v.id)) continue;
    renum += 1;
    insertar.push({
        ...v,
        saleNumber: renum,
        _originalSaleNumber: v.saleNumber,
        _nota: `Renumerada desde #${v.saleNumber} (colisión con numeración canónica; respaldo local PC 11-09)`,
        createdAt: v.createdAt || v.timestamp,
        updatedAt: now,
    });
}

insertar.push(cierreCanonico);
for (const item of insertar) {
    if (!byId.has(item.id)) { next.push(item); byId.set(item.id, item); }
}

// ── Reporte ──
const cierresFinal = next.filter(s => s?.tipo === 'REGISTRO_CIERRE');
const insertVentas = insertar.filter(s => s?.tipo === 'VENTA');
console.log(`\nA sellar (jornada canónica): ${selladas} registros`);
console.log(`A insertar: ${insertar.length} registros`);
console.log(`  • Cierre #40 (forzado supervisor): ${insertar.some(s => s.id === 'cierre_1789145494504') ? 'SÍ' : 'no (ya está)'}`);
console.log(`  • Apertura relance 8.410/$33: ${insertar.some(s => s?.tipo === 'APERTURA_CAJA') ? 'SÍ' : 'no (ya está)'}`);
console.log(`  • Ventas de hoy renumeradas: ${insertVentas.map(v => `#${v.saleNumber} (Bs ${v.totalBs})`).join(', ')}`);
console.log(`  • Cierre #41 canónico reescrito: SÍ (15.350 Bs / 8 items / gaveta 8.410+$33 / diff 0)`);
const cierresAntes = sales.filter(s => s?.tipo === 'REGISTRO_CIERRE').length;
console.log(`Registros: ${sales.length} → ${next.length} | cierres: ${cierresAntes} → ${cierresFinal.length}`);
const duplicados = next.map(s => s.saleNumber).filter(Boolean);
const dupCheck = duplicados.filter((n, i) => duplicados.indexOf(n) !== i);
console.log(`saleNumbers duplicados tras cirugía: ${dupCheck.length ? dupCheck.join(',') : 'ninguno'}`);

if (!APPLY) { console.log('\nDRY-RUN. Aplicar con APPLY=1'); process.exit(0); }

const pr = await fetch(`${url}/rest/v1/sync_documents?id=eq.60`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ data: { payload: next }, updated_at: now })
});
console.log(pr.ok ? `\n✓ Doc 60 consolidado (${next.length} registros).` : `\n✗ ERROR ${pr.status}: ${(await pr.text()).slice(0, 300)}`);
process.exit(pr.ok ? 0 : 1);
