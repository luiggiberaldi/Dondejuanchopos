#!/usr/bin/env node
/**
 * scripts/mirror-fiadas-doc60-11092026.mjs
 * Inserta en Doc 60 las dos VENTA_FIADA ya aplicadas en la PC (fiadas #802/#803
 * de jose gregorio), tomandolas del payload del comando aplicado.
 * Snapshot de rollback primero. DRY-RUN por defecto (APPLY=1).
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

// comandos aplicados más recientes con creditos
const rc = await fetch(`${url}/rest/v1/supervisor_commands?status=eq.applied&order=created_at.desc&limit=5&select=id,payload,created_at`, { headers: G });
const cmds = (await rc.json()).filter(c => Array.isArray(c.payload?.creditos) && c.payload.creditos.length > 0);
if (cmds.length === 0) { console.log('✗ No hay comando aplicado con creditos'); process.exit(1); }
const creditos = cmds[0].payload.creditos;
console.log('comando aplicado:', cmds[0].id, '|', cmds[0].created_at);
console.log('creditos:', creditos.map(f => `#${f.saleNumber} $${f.totalUsd} [${f.items.map(i => i.name).join(', ')}]`).join(' | '));

const r60 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: G });
const d60 = (await r60.json())[0];
const sales = d60.data.payload || [];
const faltantes = creditos.filter(f => !sales.some(s => s.id === f.id));
console.log(`Doc60: ${sales.length} registros | faltantes: ${faltantes.map(f => '#' + f.saleNumber).join(',') || 'ninguno'}`);
if (faltantes.length === 0) { console.log('Nada que insertar.'); process.exit(0); }
if (!APPLY) { console.log('\nDRY-RUN. Aplicar con APPLY=1'); process.exit(0); }

fs.writeFileSync('backups/snapshot-doc60-pre-fiadas.json', JSON.stringify({ updated_at: d60.updated_at, payload: sales }));
const next = [...sales, ...faltantes.map(f => ({ ...f, updatedAt: now }))];
const p = await fetch(`${url}/rest/v1/sync_documents?id=eq.60`, { method: 'PATCH', headers: H, body: JSON.stringify({ data: { payload: next }, updated_at: now }) });
console.log('Doc60 PATCH:', p.status, p.ok ? `(${next.length} registros)` : await p.text());
