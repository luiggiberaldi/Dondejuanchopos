#!/usr/bin/env node
/**
 * scripts/converge-after-abono-11092026.mjs
 * Converge la nube a la verdad del equipo activo (PC principal):
 *  A) Inserta en Doc 60 el COBRO_DEUDA #801 del abono de ramon (ya aplicado en la PC).
 *  B) Encola comando para corregir deuda de jose gregorio: 16.73 → 17.45
 *     (14.08 + margarina 2.50 + malta 0.87, con el precio REAL del catálogo de la PC).
 *  C) Reemplaza el doc de productos (4626, dataset viejo del 19-08) con el catálogo
 *     real de la PC (respaldo 23:40, 189 productos, margarina ya en 2.5).
 * Snapshots de rollback antes de cada escritura. DRY-RUN por defecto (APPLY=1).
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

const bk = JSON.parse(fs.readFileSync('backups/pc-local-backup-20260911T2340.json', 'utf8'));
const idb = bk.data?.idb || {};
const cobro = JSON.parse(fs.readFileSync('backups/cobro-ramon-aplicado.json', 'utf8'));
const pcProducts = idb.bodega_products_v1 || [];

// ── A) Doc 60: insertar cobro si falta ──
const r60 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: G });
const d60 = (await r60.json())[0];
const sales60 = d60.data.payload || [];
const yaEsta = sales60.some(s => s.id === cobro.id);
console.log(`A) Cobro ${cobro.id.slice(0, 8)} (#${cobro.saleNumber}, Bs ${cobro.totalBs}) en Doc60: ${yaEsta ? 'ya está' : 'FALTA → se insertará'}`);
let next60 = sales60;
if (!yaEsta) {
    next60 = [...sales60, { ...cobro, updatedAt: now }];
}

// ── B) Comando deuda 17.45 ──
const r0 = await fetch(`${url}/rest/v1/supervisor_commands?status=eq.applied&select=monitor_device_id&limit=1`, { headers: G });
const monitor = (await r0.json())[0]?.monitor_device_id;
const cmdDeuda = {
    action: 'update_customer_balance',
    customerId: '733d1603-5672-4dec-8f40-79aa572f5d5a',
    customerCode: 'CLI-00011',
    deuda: 17.45, favor: 0,
    autorizado_por: 'supervisor',
    nota: 'Corrección: margarina Nelly 250gr cuesta 2.5 (precio real PC), no 1.78 → deuda 14.08+2.50+0.87 = 17.45',
};

// ── C) Doc 4626 productos ──
const r46 = await fetch(`${url}/rest/v1/sync_documents?id=eq.4626&select=data,updated_at`, { headers: G });
const d46 = (await r46.json())[0];
const prods46 = d46.data.payload || [];
const tieneFantasma = prods46.some(p => p.id === '98cf0a1f-537b-45d7-b7cf-403fb5f66cb4');
const tieneMargarinaPC = prods46.some(p => p.id === '300f467e-a376-4524-aa62-fc0f70bbf45f');
console.log(`C) Doc4626: ${prods46.length} productos | dataset fantasma (98cf0a1f): ${tieneFantasma} | margarina PC: ${tieneMargarinaPC} → se reemplaza por catálogo PC (${pcProducts.length} productos)`);

console.log('\nResumen del plan:');
console.log(`  Doc60: ${sales60.length} → ${next60.length} registros`);
console.log(`  Comando: CLI-00011 deuda → 17.45`);
console.log(`  Doc4626: ${prods46.length} → ${pcProducts.length} productos`);
if (!APPLY) { console.log('\nDRY-RUN. Aplicar con APPLY=1'); process.exit(0); }

// snapshots
fs.writeFileSync('backups/snapshot-doc60-pre-cobro.json', JSON.stringify({ updated_at: d60.updated_at, payload: sales60 }));
fs.writeFileSync('backups/snapshot-doc4626-pre-convergencia.json', JSON.stringify({ updated_at: d46.updated_at, payload: prods46 }));

// A) PATCH Doc 60 si cambió
if (next60 !== sales60) {
    const p1 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60`, { method: 'PATCH', headers: H, body: JSON.stringify({ data: { payload: next60 }, updated_at: now }) });
    console.log('A) Doc60 PATCH:', p1.status);
}
// B) comando
const p2 = await fetch(`${url}/rest/v1/supervisor_commands`, { method: 'POST', headers: H, body: JSON.stringify({
    monitor_device_id: monitor, primary_device_id: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
    command_type: 'inventory_update', status: 'pending', payload: cmdDeuda }) });
console.log('B) comando deuda 17.45:', p2.status);
// C) PATCH Doc 4626
const p3 = await fetch(`${url}/rest/v1/sync_documents?id=eq.4626`, { method: 'PATCH', headers: H, body: JSON.stringify({ data: { payload: pcProducts }, updated_at: now }) });
console.log('C) Doc4626 PATCH:', p3.status);
