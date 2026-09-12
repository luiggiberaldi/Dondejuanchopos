#!/usr/bin/env node
/**
 * scripts/dedupe-mono-cli00011.mjs  (INSPECCIÓN, read-only)
 *
 * 1. Localiza el doc de productos y muestra precios de "nelly" y "malta".
 * 2. Revisa si Doc 60 tiene ventas referenciando a CLI-00019 (duplicado a borrar).
 * Uso: node scripts/dedupe-mono-cli00011.mjs
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
const H = { apikey: key, Authorization: `Bearer ${key}` };

const ID19 = '5792bf7e-8e99-48f2-84da-17c1530c684f';
const ID11 = '733d1603-5672-4dec-8f40-79aa572f5d5a';

// 1) doc de productos
const lr = await fetch(`${url}/rest/v1/sync_documents?select=id,updated_at`, { headers: H });
const docs = await lr.json();
let prodDoc = null;
for (const d of docs) {
    const r2 = await fetch(`${url}/rest/v1/sync_documents?id=eq.${d.id}&select=data`, { headers: H });
    const p = (await r2.json())[0]?.data?.payload;
    if (Array.isArray(p) && p.length > 0 && (p[0].costo !== undefined || p[0].price !== undefined || p[0].priceUsd !== undefined)) {
        prodDoc = { id: d.id, n: p.length };
        for (const pr of p) {
            const n = String(pr.nombre || pr.name || '');
            if (/nelly/i.test(n) || /malta/i.test(n)) {
                console.log('PROD:', JSON.stringify({
                    id: pr.id || pr._id,
                    nombre: n,
                    precioUsd: pr.priceUsd ?? pr.precioUsd ?? pr.price,
                    precioBs: pr.priceBs ?? pr.precioBs,
                    unidad: pr.unidad || pr.unit || '',
                    formato: pr.formato || pr.presentation || '',
                }));
            }
        }
        break;
    }
}
console.log('doc de productos:', JSON.stringify(prodDoc));

// 2) referencias en Doc 60
const r4 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data`, { headers: H });
const sales = (await r4.json())[0].data.payload || [];
const ref19 = sales.filter(s => JSON.stringify(s).includes(ID19));
const ref11 = sales.filter(s => JSON.stringify(s).includes(ID11));
console.log(`Doc60 → refs CLI-00019: ${ref19.length} | refs CLI-00011: ${ref11.length}`);
for (const s of ref19) console.log('  ref19:', s.tipo, s.id, s.timestamp);
