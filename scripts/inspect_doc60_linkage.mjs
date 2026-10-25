import fs from 'fs';
import path from 'path';

// Diagnóstico SOLO LECTURA del doc 60 (invariante Jornada 10-09).
const envPath = path.resolve(process.cwd(), '.env');
const env = {};
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const idx = t.indexOf('=');
        if (idx > -1) {
            let val = t.substring(idx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
            env[t.substring(0, idx).trim()] = val;
        }
    });
}
const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_CLOUD_URL;
const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;

const res = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const doc = await res.json();
const sales = doc[0]?.data?.payload || [];

const cierres = sales.filter(s => s.tipo === 'REGISTRO_CIERRE');
console.log('Cierres (id | cierreId | cajaCerrada | jornada):');
for (const c of cierres) {
    console.log(`  ${c.id} | ${c.cierreId} | ${c.cajaCerrada} | ${c.summary?.jornadaCanonica ?? '-'}`);
}

console.log('\nVentas 785-800 (saleNumber | id | cierreId | cajaCerrada | totalBs):');
for (let n = 785; n <= 800; n++) {
    const matches = sales.filter(s => s.tipo === 'VENTA' && s.saleNumber === n);
    if (matches.length === 0) { console.log(`  #${n}: (ausente)`); continue; }
    for (const v of matches) {
        console.log(`  #${n}: ${v.id} | cierreId=${v.cierreId} | cajaCerrada=${v.cajaCerrada} | ${v.totalBs}${matches.length > 1 ? '  << DUPLICADO' : ''}`);
    }
}

console.log('\nAperturas:');
for (const a of sales.filter(s => s.tipo === 'APERTURA_CAJA')) {
    console.log(`  ${a.id} | cajaCerrada=${a.cajaCerrada} | openingBs=${a.openingBs} openingUsd=${a.openingUsd} | ts=${a.timestamp}`);
}
console.log('\nGasto teipe:');
const gasto = sales.find(s => s.id === 'gasto_teipe_1789067070525');
console.log(gasto ? `  cajaCerrada=${gasto.cajaCerrada} | cierreId=${gasto.cierreId}` : '  (ausente)');
