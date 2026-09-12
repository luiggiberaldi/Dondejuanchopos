#!/usr/bin/env node
/**
 * scripts/retry-delete-cli00019.mjs
 * Reencola el delete_customer del duplicado CLI-00019, espera y verifica Doc 52.
 * Uso: node scripts/retry-delete-cli00019.mjs
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

const r0 = await fetch(`${url}/rest/v1/supervisor_commands?status=eq.applied&select=monitor_device_id&limit=1`, { headers: G });
const monitor = (await r0.json())[0]?.monitor_device_id;

const r = await fetch(`${url}/rest/v1/supervisor_commands`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
        monitor_device_id: monitor,
        primary_device_id: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        command_type: 'inventory_update', status: 'pending',
        payload: {
            action: 'delete_customer',
            customerId: '5792bf7e-8e99-48f2-84da-17c1530c684f',
            customerCode: 'CLI-00019', force: true,
            autorizado_por: 'supervisor',
            nota: 'Reintento: eliminar duplicado de mono (CLI-00019); se conserva CLI-00011',
        },
    }),
});
console.log('reintento delete:', r.status, r.ok ? 'ok' : await r.text());

// esperar a que el dispositivo lo procese
await new Promise(res => setTimeout(res, 90_000));

const r2 = await fetch(`${url}/rest/v1/supervisor_commands?order=created_at.desc&limit=2&select=status,error_reason,created_at`, { headers: G });
for (const c of await r2.json()) console.log('CMD', c.status, '|', (c.error_reason || '').slice(0, 80), '|', c.created_at);

const r3 = await fetch(`${url}/rest/v1/sync_documents?id=eq.52&select=data`, { headers: G });
const cust = ((await r3.json())[0].data.payload) || [];
const monos = cust.filter(c => /mono/i.test(c.name || ''));
console.log('clientes totales:', cust.length, '| monos:', monos.length);
for (const m of monos) console.log('MONO:', JSON.stringify({ code: m.code, name: m.name, phone: m.phone, deuda: m.deuda, favor: m.favor }));
