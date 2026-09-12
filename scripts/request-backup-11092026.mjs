#!/usr/bin/env node
/**
 * scripts/request-backup-11092026.mjs
 * Encola un comando request_full_backup para la PC principal, para rescatar
 * cualquier venta posterior al respaldo de 23:40 UTC.
 * Uso: node scripts/request-backup-11092026.mjs
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

// monitor_device_id real (de un comando aplicado)
const r0 = await fetch(`${url}/rest/v1/supervisor_commands?status=eq.applied&select=monitor_device_id&limit=1`, { headers: H });
const monitor = (await r0.json())[0]?.monitor_device_id;

const cmd = {
    monitor_device_id: monitor,
    primary_device_id: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
    command_type: 'request_full_backup',
    status: 'pending',
    payload: { requested_by: 'auditoria-remota', motivo: 'rescate ventas posteriores al respaldo 23:40 UTC' },
};
const r = await fetch(`${url}/rest/v1/supervisor_commands`, { method: 'POST', headers: H, body: JSON.stringify(cmd) });
console.log('request_full_backup:', r.status, r.ok ? 'ok' : await r.text());
process.exit(r.ok ? 0 : 1);
