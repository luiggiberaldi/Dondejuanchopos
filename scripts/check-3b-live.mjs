#!/usr/bin/env node
/**
 * scripts/check-3b-live.mjs — ¿Ya corre la FASE 3B en la PC?
 *
 * Determina por DATOS (no por versión) si la PC numera con el allocator de nube:
 *   - 3B VIVO     → cada venta/abono deja una fila `sale_number_claim` en
 *                   supervisor_commands (candidate = número asignado) y el registro
 *                   coincide (o es provisional si la nube falló al facturar).
 *   - CÓDIGO VIEJO → ventas numeradas max(local)+1 SIN fila de reclamo.
 *
 * SOLO LECTURA. Uso: node scripts/check-3b-live.mjs [horas_hacia_atrás=12]
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

const horas = Number(process.argv[2]) || 12;
const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();

const rd = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
const doc = (await rd.json())[0];
const sales = (doc.data.payload || [])
    .filter((s) => s && ['VENTA', 'VENTA_FIADA', 'COBRO_DEUDA'].includes(s.tipo) && String(s.createdAt || s.timestamp || '') >= desde)
    .sort((a, b) => String(a.createdAt || a.timestamp).localeCompare(String(b.createdAt || b.timestamp)));

const rc = await fetch(`${url}/rest/v1/supervisor_commands?payload->>action=eq.sale_number_claim&select=id,payload,created_at&created_at=gte.${desde}&order=created_at.asc`, { headers: H });
const claims = await rc.json();
const claimList = Array.isArray(claims) ? claims : [];

console.log(`═'.repeat(70)`);
console.log(`¿FASE 3B viva en la PC? — registros de numeración en las últimas ${horas} h`);
console.log(`═'.repeat(70)`);
console.log(`ventas/abonos en Doc 60 desde ${desde}: ${sales.length}`);
console.log(`filas sale_number_claim desde esa hora: ${claimList.length}\n`);

const sinClaim = [];
for (const s of sales) {
    const t = s.createdAt || s.timestamp;
    const matching = claimList.filter((c) => Math.abs(new Date(c.created_at) - new Date(t)) < 90_000);
    const n = s.saleNumber;
    if (matching.length) {
        const c = matching[matching.length - 1];
        const ok = Number((c.payload || {}).candidate) === Number(n);
        console.log(`  ${t}  #${n}  ${s.tipo}  ← CLAIM ${c.id.slice(0, 8)} candidate=${(c.payload || {}).candidate} ${ok ? 'COINCIDE ✔' : '⚠ difiere'}`);
    } else if (s.saleNumberProvisional) {
        console.log(`  ${t}  #${n}  ${s.tipo}  ← PROVISIONAL (fallback offline de 3B; sin nube al facturar)`);
    } else {
        console.log(`  ${t}  #${n}  ${s.tipo}  ← sin reclamo (max(local)+1)`);
        sinClaim.push(s);
    }
}

console.log('\nVEREDICTO:');
if (sales.length === 0) {
    console.log('  ⏳ Sin ventas en la ventana — no hay evidencia todavía. Repite tras la próxima venta.');
} else if (sinClaim.length === 0 && claimList.length > 0) {
    console.log('  ✅ 3B VIVO: todas las ventas recientes salieron del allocator de nube (con reclamo).');
} else if (sinClaim.length === 0 && claimList.length === 0) {
    console.log('  ⚠ Sin ventas con reclamo y sin ventas sin reclamo — revisar ventana.');
} else {
    const last = sinClaim[sinClaim.length - 1];
    console.log(`  ❌ CÓDIGO VIEJO aún activo: la última venta sin reclamo fue ${last.createdAt || last.timestamp} (#${last.saleNumber}).`);
    console.log('     La PC cargará el build 3B en su próximo ciclo de Service Worker (~15 min tras el deploy).');
}
console.log(`\nDoc 60 updated_at: ${doc.updated_at}`);
