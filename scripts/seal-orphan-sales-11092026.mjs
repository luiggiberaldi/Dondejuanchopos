#!/usr/bin/env node
/**
 * scripts/seal-orphan-sales-11092026.mjs
 *
 * Sella (cajaCerrada=true) las 22 ventas huérfanas #759–#784 (8–10 sept) que
 * pertenecen a turnos YA CERRADOS históricamente (cierres #37–#39) pero que
 * quedaron sin sello al ser restauradas. Solo cambia ese flag por ID exacto.
 * No borra nada, no modifica montos.
 *
 * DRY-RUN por defecto:  node scripts/seal-orphan-sales-11092026.mjs
 * Aplicar:              APPLY=1 node scripts/seal-orphan-sales-11092026.mjs
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

const r = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
const doc = (await r.json())[0];
const sales = doc.data.payload || [];
const openAperturas = sales.filter(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
if (openAperturas.length !== 1) { console.error(`✗ Se esperaba 1 apertura abierta, hay ${openAperturas.length}. Abortando.`); process.exit(1); }
const from = new Date(openAperturas[0].timestamp).getTime();
const TIPOS = ['VENTA', 'GASTO_INTERNO', 'REGISTRO_CIERRE', 'COBRO_DEUDA', 'VENTA_FIADA', 'APERTURA_CAJA'];
const orphans = sales.filter(s => s.cajaCerrada !== true && TIPOS.includes(s.tipo || 'VENTA') && s.status !== 'ANULADA' && new Date(s.timestamp || 0).getTime() < from);
console.log(`Sellando ${orphans.length} ventas huérfanas (#${orphans.map(o => o.saleNumber).join(', #')})…`);
if (!APPLY) { console.log('DRY-RUN. Aplicar con APPLY=1'); process.exit(0); }

const now = new Date().toISOString();
const idSet = new Set(orphans.map(o => o.id));
const next = sales.map(s => idSet.has(s.id) ? { ...s, cajaCerrada: true, updatedAt: now } : s);
const pr = await fetch(`${url}/rest/v1/sync_documents?id=eq.60`, { method: 'PATCH', headers: H, body: JSON.stringify({ data: { payload: next }, updated_at: now }) });
console.log(pr.ok ? `✓ Doc 60 actualizado. Selladas ${idSet.size} ventas. Registros: ${sales.length} → ${next.length}` : `✗ ERROR ${pr.status}: ${await pr.text()}`);
process.exit(pr.ok ? 0 : 1);
