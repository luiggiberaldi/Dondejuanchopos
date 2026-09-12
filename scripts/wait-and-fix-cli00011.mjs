#!/usr/bin/env node
/**
 * scripts/wait-and-fix-cli00011.mjs
 *
 * Bucle de reintentos: cada ~3.5 min encola el comando update_customer_balance
 * para CLI-00011 (deuda 14.08 / favor 0) y verifica su resultado.
 * - Si la PC aún corre código viejo, el comando falla con "Acción inválida"
 *   (inofensivo, sin efectos) y se reintenta.
 * - Cuando la PC recargue con el código nuevo (SW autoUpdate), el comando se
 *   aplica y el script verifica Doc 52 y termina en éxito.
 *
 * Uso:            node scripts/wait-and-fix-cli00011.mjs
 * Máx. minutos:   MAX_MINUTES=40 node scripts/wait-and-fix-cli00011.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const DEVICE_ID = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
const MONITOR_ID = 'mon_j3mewwp8q6_mtdn9jyo';
const MAX_MINUTES = parseInt(process.env.MAX_MINUTES || '40', 10);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const R = { apikey: key, Authorization: `Bearer ${key}` };

async function getCli() {
    const q = await fetch(`${url}/rest/v1/sync_documents?id=eq.52&select=data`, { headers: R });
    const doc = (await q.json())[0];
    return (doc.data?.payload || []).find(x => x.code === 'CLI-00011');
}

async function enqueueFix() {
    const id = crypto.randomUUID();
    const payload = {
        action: 'update_customer_balance', commandId: id,
        customerId: '733d1603-5672-4dec-8f40-79aa572f5d5a', customerCode: 'CLI-00011',
        deuda: 14.08, favor: 0,
        reason: 'Reintento automatico: saldo autorizado de Jose Gregorio (14.08/0)',
        customer: { id: '733d1603-5672-4dec-8f40-79aa572f5d5a', code: 'CLI-00011', name: 'jose gregorio', deuda: 14.08, favor: 0, phone: '04128677412', casheaDeuda: 0 },
    };
    const r = await fetch(`${url}/rest/v1/supervisor_commands`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ id, primary_device_id: DEVICE_ID, monitor_device_id: MONITOR_ID, command_type: 'inventory_update', status: 'pending', payload })
    });
    if (!r.ok) { console.log(`  ✗ INSERT ${r.status}: ${await r.text()}`); return null; }
    return (await r.json())[0]?.id;
}

async function checkCommand(id) {
    const r = await fetch(`${url}/rest/v1/supervisor_commands?id=eq.${id}&select=status,error_reason,applied_at`, { headers: R });
    return (await r.json())[0];
}

const start = Date.now();
let attempt = 0;
while ((Date.now() - start) < MAX_MINUTES * 60 * 1000) {
    attempt++;
    const cli = await getCli();
    const ok = cli && Number(cli.deuda) === 14.08 && !(Number(cli.favor) || 0) && cli.name === 'jose gregorio';
    console.log(`\n[Intento ${attempt} · ${new Date().toLocaleTimeString()}] CLI-00011: ${JSON.stringify({ name: cli?.name, deuda: cli?.deuda, favor: cli?.favor })} ${ok ? '✓ CORRECTO' : '→ encolando…'}`);
    if (ok) {
        // Marcar d0a94c27 como aplicado para que no quede pendiente eterno
        await fetch(`${url}/rest/v1/supervisor_commands?id=eq.d0a94c27-bd0f-445a-885c-4b984370768f`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({ status: 'applied', applied_at: new Date().toISOString(), error_reason: 'Saldo ya corregido vía reintentos automáticos' })
        });
        console.log('\n✓✓ OBJETIVO LOGRADO: CLI-00011 = jose gregorio / deuda $14.08 / favor $0. Doc 52 corregido.');
        process.exit(0);
    }
    const id = await enqueueFix();
    if (!id) { await sleep(60_000); continue; }
    console.log(`  → comando ${id.slice(0, 8)} encolado; esperando 210s…`);
    await sleep(210_000);
    const st = await checkCommand(id);
    console.log(`  → resultado: ${st?.status} ${st?.error_reason ? `(${st.error_reason})` : ''} aplicado=${st?.applied_at || '—'}`);
    if (st?.status === 'applied') {
        const cli2 = await getCli();
        console.log(`  → CLI tras aplicar: ${JSON.stringify({ name: cli2?.name, deuda: cli2?.deuda, favor: cli2?.favor })}`);
        if (cli2 && Number(cli2.deuda) === 14.08 && !(Number(cli2.favor) || 0)) {
            await fetch(`${url}/rest/v1/supervisor_commands?id=eq.d0a94c27-bd0f-445a-885c-4b984370768f`, {
                method: 'PATCH', headers: H,
                body: JSON.stringify({ status: 'applied', applied_at: new Date().toISOString(), error_reason: 'Saldo corregido (comando d0a94c27 superado por reencolado)' })
            });
            console.log('\n✓✓ OBJETIVO LOGRADO: CLI-00011 corregido en Doc 52.');
            process.exit(0);
        }
    }
}
console.log(`\n⏱ Tiempo máximo (${MAX_MINUTES} min) agotado sin éxito. La PC sigue en código viejo o sin procesar. Revisar manualmente.`);
process.exit(1);
