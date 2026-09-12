#!/usr/bin/env node
/**
 * scripts/fix-cobro-ramon-local-11092026.mjs
 * Encola update_sales_record para reclasificar el cobro de ramon en el PC
 * como pago_movil (el dueño lo recibió, no suma efectivo a la gaveta local).
 * Uso: node scripts/fix-cobro-ramon-local-11092026.mjs
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

const r0 = await fetch(`${url}/rest/v1/supervisor_commands?monitor_device_id=not.is.null&order=created_at.desc&limit=1&select=monitor_device_id`, { headers: G });
const monitor = (await r0.json())[0]?.monitor_device_id;

const r = await fetch(`${url}/rest/v1/supervisor_commands`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
        monitor_device_id: monitor,
        primary_device_id: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        command_type: 'inventory_update', status: 'pending',
        payload: {
            action: 'update_sales_record',
            recordId: '5eb6d6bd-1fd3-4f87-824a-ba2855524b73',
            patch: {
                paymentMethod: 'pago_movil',
                payments: [{ methodId: 'pago_movil', amount: 20000, currency: 'BS', amountUsd: 21.28, amountBs: 20000, methodLabel: 'Pago Móvil' }],
            },
            nota: 'El dueño recibió el abono de ramon por PAGO MÓVIL — no suma efectivo a la gaveta',
        },
    }),
});
console.log('enqueue correccion local:', r.status, r.ok ? 'ok' : await r.text());
