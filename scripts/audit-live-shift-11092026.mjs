#!/usr/bin/env node
/**
 * scripts/audit-live-shift-11092026.mjs  (READ-ONLY)
 *
 * Auditoría de solo lectura del estado ACTUAL en la nube para el
 * Dispositivo Autoritativo PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F.
 *
 * NO ESCRIBE NADA. Solo GETs a Supabase:
 *   1. Doc 60  (bodega_sales_v1): cierres, aperturas, ventas de la jornada activa.
 *   2. Documento de clientes (bodega_customers_v1): saldo de CLI-00011.
 *   3. supervisor_commands: estado del comando d0a94c27 y últimos comandos.
 *
 * Uso:  node scripts/audit-live-shift-11092026.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const DEVICE_ID = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
const CLI_00011_ID = '733d1603-5672-4dec-8f40-79aa572f5d5a';

// Datos canónicos documentados de la Jornada 10-09-2026 (para comparar)
const CANONICAL = {
    apertura: { id: 'apertura_1789057800000', openingBs: 9980, openingUsd: 33 },
    sales: [
        { n: 785, bs: 5550 }, { n: 786, bs: 660 }, { n: 787, bs: 880 },
        { n: 788, bs: 440 }, { n: 789, bs: 1210 }, { n: 790, bs: 200 },
        { n: 791, bs: 6280 }, { n: 792, bs: 130 },
    ],
    gastoTeipe: { id: 'gasto_teipe_1789067070525', bs: 1700 },
    expectedDrawer: { bs: 8410, usd: 33 },
    expectedClosures: 40,
};

function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return {};
    const env = {};
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const i = t.indexOf('=');
        if (i > -1) {
            let v = t.substring(i + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
            env[t.substring(0, i).trim()] = v;
        }
    });
    return env;
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_CLOUD_URL;
const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
    console.error('✗ Falta VITE_SUPABASE_URL / key en .env');
    process.exit(1);
}
const H = { apikey: key, Authorization: `Bearer ${key}` };

async function getDoc(id) {
    const r = await fetch(`${url}/rest/v1/sync_documents?id=eq.${id}&select=id,device_id,collection,updated_at,data`, { headers: H });
    if (!r.ok) throw new Error(`Doc ${id}: ${r.status} ${await r.text()}`);
    return (await r.json())[0] || null;
}

function bs(x) { return (Number(x) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

console.log(`\n════════ AUDITORÍA READ-ONLY — ${new Date().toISOString()} ════════`);
console.log(`Dispositivo autoritativo: ${DEVICE_ID}\n`);

// ── 1. DOC 60: VENTAS / CIERRES / TURNOS ────────────────────────────────────
const doc60 = await getDoc(60);
if (!doc60) {
    console.error('✗ Doc 60 no encontrado');
    process.exit(1);
}
const sales = doc60?.data?.payload || [];
const updated60 = doc60.updated_at;
console.log(`── DOC 60 (bodega_sales_v1) — updated_at: ${updated60} — ${sales.length} registros ──`);

const cierres = sales.filter(s => s?.tipo === 'REGISTRO_CIERRE');
console.log(`Cierres (REGISTRO_CIERRE): ${cierres.length} (esperados ≥ ${CANONICAL.expectedClosures})`);

// Último cierre (el más reciente por cierreId/timestamp)
const lastCierre = [...cierres].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0];
if (lastCierre) {
    console.log(`\nÚLTIMO CIERRE registrado:`);
    console.log(`  cierreId:  ${lastCierre.cierreId || '(sin id)'}`);
    console.log(`  #cierre:   ${lastCierre.cierreNumber ?? lastCierre.summary?.cierreNumber ?? '?'}`);
    console.log(`  timestamp: ${lastCierre.timestamp}`);
    const sum = lastCierre.summary || {};
    console.log(`  summary.ventasUsd:  ${bs(sum.ventasUsd ?? sum.totalUsd)}  | ventasBs: ${bs(sum.ventasBs ?? sum.totalBs)}`);
    console.log(`  summary.gaveta:     Bs ${bs(sum.finalBs ?? sum.gavetaBs)} | $${bs(sum.finalUsd ?? sum.gavetaUsd)}`);
    console.log(`  summary crudo: ${JSON.stringify(sum).slice(0, 600)}`);
}

// Aperturas (todas, para ver espurias y la nueva)
const aperturas = sales.filter(s => s?.tipo === 'APERTURA_CAJA');
console.log(`\nAPERTURAS en Doc 60: ${aperturas.length}`);
[...aperturas].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).slice(0, 5).forEach(a => {
    console.log(`  • ${a.id} | ts=${a.timestamp} | openingBs=${bs(a.openingBs)} | openingUsd=$${bs(a.openingUsd)} | cajaCerrada=${a.cajaCerrada} | cajero=${a.cajero || '?'}`);
});

// Turno activo: registros sin cajaCerrada después de la última apertura activa
const activos = sales.filter(s => s?.tipo !== 'REGISTRO_CIERRE' && s?.tipo !== 'APERTURA_CAJA' && !s?.cajaCerrada);
console.log(`\nMOVIMIENTOS DEL TURNO ACTIVO (cajaCerrada=false, sin cierres/aperturas): ${activos.length}`);
[...activos].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).slice(0, 15).forEach(s => {
    const monto = s.tipo === 'GASTO_INTERNO' ? `GASTO Bs ${bs(s.montoBs)}` : `#${s.saleNumber} Bs ${bs(s.totalBs)} ($${bs(s.totalUsd)})`;
    const pay = (s.payments || []).map(p => p.methodId).join('+') || s.paymentMethod || '';
    console.log(`  • ${s.tipo} | ${s.timestamp} | ${monto} | ${pay} | ${s.customerName || ''}`);
});

// Resumen del turno activo
const ventasActivas = activos.filter(s => s.tipo === 'VENTA');
const gastoActivo = activos.filter(s => s.tipo === 'GASTO_INTERNO');
const sumBs = ventasActivas.reduce((a, s) => a + (Number(s.totalBs) || 0), 0);
const sumUsd = ventasActivas.reduce((a, s) => a + (Number(s.totalUsd) || 0), 0);
console.log(`\nRESUMEN TURNO ACTIVO: ${ventasActivas.length} ventas | Bs ${bs(sumBs)} | $${bs(sumUsd)} | ${gastoActivo.length} gastos`);

// ── 2. VERIFICACIÓN DE LA JORNADA 10-09 (cierre errado vs canónico) ────────
console.log(`\n── VERIFICACIÓN JORNADA 10-09-2026 (canónico vs cloud) ──`);
const canonIds = [CANONICAL.apertura.id, CANONICAL.gastoTeipe.id, ...[]];
const sale785 = sales.find(s => s.saleNumber === 785);
const sale792 = sales.find(s => s.saleNumber === 792);
console.log(`  Venta #785 (5.550 Bs PM): ${sale785 ? `presente, Bs ${bs(sale785.totalBs)}, id=${sale785.id}` : '✗ FALTA'}`);
console.log(`  Venta #792 (130 Bs efectivo): ${sale792 ? `presente, Bs ${bs(sale792.totalBs)}, id=${sale792.id}` : '✗ FALTA'}`);
const aperCanon = sales.find(a => a.id === CANONICAL.apertura.id);
console.log(`  Apertura canónica 9.980/$33: ${aperCanon ? `presente (cajaCerrada=${aperCanon.cajaCerrada})` : '✗ FALTA'}`);
const gastoCanon = sales.find(g => g.id === CANONICAL.gastoTeipe.id);
console.log(`  Gasto teipe 1.700: ${gastoCanon ? 'presente' : '✗ FALTA'}`);

// ── 3. CLIENTES: CLI-00011 ──────────────────────────────────────────────────
console.log(`\n── CLIENTES (buscando doc bodega_customers_v1) ──`);
let custDoc = [];
{
    const r = await fetch(`${url}/rest/v1/sync_documents?device_id=eq.${DEVICE_ID}&select=id,device_id,collection,updated_at,data`, { headers: H });
    if (r.ok) custDoc = (await r.json()) || [];
}
let cli = null, custDocId = null, custUpdatedAt = null;
for (const row of custDoc) {
    const payload = row?.data?.payload;
    if (Array.isArray(payload)) {
        const found = payload.find(c => c?.id === CLI_00011_ID || c?.code === 'CLI-00011');
        if (found) {
            cli = found;
            custDocId = row.id;
            custUpdatedAt = row.updated_at;
            break;
        }
    }
}
if (cli) {
    console.log(`  Doc clientes: id=${custDocId}, updated_at=${custUpdatedAt}`);
    console.log(`  CLI-00011 "${cli.name}": deuda=$${bs(cli.deuda)}, favor=$${bs(cli.favor)}, updatedAt=${cli.updatedAt || '?'}`);
    console.log(`  ESPERADO (autorizado): deuda=$14.08, favor=$0.00 → ${Math.abs((Number(cli.deuda) || 0) - 14.08) < 0.01 && !(Number(cli.favor) || 0) ? '✅ OK' : '❌ DESVIADO'}`);
} else {
    console.log(`  ✗ CLI-00011 no encontrado en ningún documento de clientes del dispositivo.`);
    console.log(`  Documentos escaneados: ${custDoc.map(r => r.id).join(', ') || 'ninguno'}`);
}

// ── 4. COMANDOS DEL SUPERVISOR ──────────────────────────────────────────────
console.log(`\n── COMANDOS SUPERVISOR (supervisor_commands) ──`);
const cmdRes = await fetch(`${url}/rest/v1/supervisor_commands?primary_device_id=eq.${DEVICE_ID}&select=id,command_type,status,error_reason,applied_at,created_at,payload&order=created_at.desc&limit=15`, { headers: H });
if (cmdRes.ok) {
    const cmds = await cmdRes.json();
    console.log(`Últimos ${cmds.length} comandos:`);
    cmds.forEach(c => {
        const act = c.payload?.action || c.command_type;
        const extra = c.payload?.action === 'update_customer_balance' ? ` → deuda=${c.payload?.deuda}, favor=${c.payload?.favor}` : '';
        console.log(`  • [${c.status}] ${c.command_type} (${act}${extra}) | creado=${c.created_at} | aplicado=${c.applied_at || '—'}${c.error_reason ? ` | error=${c.error_reason}` : ''}`);
    });
    const d0 = cmds.find(c => c.id?.startsWith('d0a94c27'));
    if (d0) console.log(`\nComando d0a94c27 (CLI-00011): status=${d0.status}, applied=${d0.applied_at || 'NUNCA'}, error=${d0.error_reason || '—'}`);
} else {
    console.log(`  ✗ No se pudo leer supervisor_commands: ${cmdRes.status}`);
}

console.log(`\n════════ FIN AUDITORÍA (solo lectura, nada fue modificado) ════════\n`);
