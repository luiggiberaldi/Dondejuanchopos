import fs from 'fs';
import path from 'path';

// Evidencia forense SOLO LECTURA: por qué #785/#786 apuntan a cierre_1789145494504
// y no al canónico 1789145662786 (guardia shiftHistoricalCierresGuard).
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

const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o?.[k]]));
const VKEYS = ['id', 'saleNumber', 'timestamp', 'createdAt', 'updatedAt', 'cierreId', 'cajaCerrada', 'totalBs', '_parche'];
const CKEYS = ['id', 'cierreId', 'timestamp', 'createdAt', 'updatedAt', 'cajaCerrada'];

for (let n = 785; n <= 792; n++) {
    const v = sales.find(s => s.tipo === 'VENTA' && s.saleNumber === n);
    console.log(`VENTA #${n}:`, JSON.stringify(pick(v, VKEYS)));
}
const gasto = sales.find(s => s.id === 'gasto_teipe_1789067070525');
console.log('GASTO TEIPE:', JSON.stringify(pick(gasto, ['id', 'cierreId', 'cajaCerrada', 'updatedAt'])));

for (const cid of ['cierre_1789145494504', 'cierre_1789145662786']) {
    const c = sales.find(s => s.id === cid);
    console.log(`CIERRE ${cid}:`, JSON.stringify(pick(c, CKEYS)));
    console.log('   summary:', JSON.stringify(c?.summary));
}
