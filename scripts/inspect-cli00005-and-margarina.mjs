#!/usr/bin/env node
/** Read-only: CLI-00005 completo + producto NELLY MARGARINA 250 GRS completo. */
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
const H = { apikey: key, Authorization: `Bearer ${key}` };

const r = await fetch(`${url}/rest/v1/sync_documents?id=eq.52&select=data`, { headers: H });
const cust = ((await r.json())[0].data.payload) || [];
const c5 = cust.find(c => c.code === 'CLI-00005');
console.log('CLI-00005 completo:');
console.log(JSON.stringify(c5, null, 1));

const r2 = await fetch(`${url}/rest/v1/sync_documents?id=eq.4626&select=data`, { headers: H });
const prods = ((await r2.json())[0].data.payload) || [];
const nelly = prods.find(p => /nelly.*250/i.test(String(p.nombre || p.name || '')));
console.log('\nNELLY 250gr completo:');
console.log(JSON.stringify(nelly, null, 1));
