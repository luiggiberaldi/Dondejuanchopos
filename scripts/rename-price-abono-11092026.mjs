#!/usr/bin/env node
/**
 * scripts/rename-price-abono-11092026.mjs
 * Encola 3 comandos supervisor:
 *  1) Renombrar CLI-00011 "mono" → "jose gregorio" (saldo se mantiene 16.73/0).
 *  2) Corregir precio NELLY MARGARINA 250 GRS: 1.78 → 2.5 USD.
 *  3) Abono de ramon (CLI-00005): 20.000 Bs efectivo (tasa 940) = $21.28 → deuda 66.22.
 * Uso: node scripts/rename-price-abono-11092026.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

// 1) Renombrar mono → jose gregorio
const cmdRename = {
    action: 'update_customer_balance',
    customerId: '733d1603-5672-4dec-8f40-79aa572f5d5a',
    customerCode: 'CLI-00011',
    deuda: 16.73, favor: 0,
    customer: { name: 'jose gregorio', phone: '04128677412' },
    autorizado_por: 'supervisor',
    nota: 'Renombrar mono → jose gregorio (saldo autorizado se mantiene: deuda 16.73, favor 0)',
};

// 2) Precio NELLY 250gr → 2.5 USD (action 'edit' del procesador de inventario remoto)
const cmdPrice = {
    action: 'edit',
    productId: '98cf0a1f-537b-45d7-b7cf-403fb5f66cb4',
    data: {
        priceUsd: 2.5,
        priceUsdt: 2.5,
        baseUpdatedAt: '2026-08-15T22:05:34.226Z',
        monitor_device_id: null, // se rellena abajo
    },
    nota: 'Precio real de NELLY MARGARINA 250 GRS: 2.5 USD (estaba 1.78)',
};

// 3) Abono de ramon (CLI-00005): 20.000 Bs efectivo a tasa 940 = $21.28
const cobroId = crypto.randomUUID();
const cmdAbono = {
    action: 'register_customer_payment',
    customerId: '1211d262-e0cf-4cb4-9956-89424f557f77',
    customerCode: 'CLI-00005',
    deuda: 66.22, favor: 0, // 87.50 - 21.28
    cobro: {
        id: cobroId,
        timestamp: now, createdAt: now, updatedAt: now,
        usuarioId: null, usuarioNombre: 'Supervisor', usuarioRol: 'SUPERVISOR',
        actor: { id: null, nombre: 'Supervisor', rol: 'SUPERVISOR' },
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        tipo: 'COBRO_DEUDA',
        saleNumber: 801,
        rate: 940,
        status: 'COMPLETADA',
        clienteId: '1211d262-e0cf-4cb4-9956-89424f557f77',
        clienteName: 'ramon',
        totalBs: 20000, totalUsd: 21.28,
        paymentMethod: 'efectivo_bs',
        payments: [{ methodId: 'efectivo_bs', amount: 20000, currency: 'BS', amountUsd: 21.28, amountBs: 20000, methodLabel: 'efectivo bs' }],
        customerId: '1211d262-e0cf-4cb4-9956-89424f557f77',
        customerName: 'ramon',
        items: [{ name: 'Abono de deuda: ramon', qty: 1, priceUsd: 21.28, costBs: 0 }],
        nota: 'Abono remoto del supervisor: 20.000 Bs en efectivo a la deuda (tasa 940)',
        _origen: 'comando_supervisor',
    },
    nota: 'Abono de ramon (CLI-00005): 20.000 Bs efectivo (tasa 940) = $21.28 → deuda 87.50-21.28 = 66.22',
};

// monitor_device_id real
const r0 = await fetch(`${url}/rest/v1/supervisor_commands?status=eq.applied&select=monitor_device_id&limit=1`, { headers: G });
const monitor = (await r0.json())[0]?.monitor_device_id;
cmdPrice.data.monitor_device_id = monitor;

console.log('DRY-RUN — comandos a encolar:');
console.log(' 1.', JSON.stringify(cmdRename).slice(0, 220));
console.log(' 2.', JSON.stringify(cmdPrice).slice(0, 220));
console.log(' 3.', JSON.stringify({ ...cmdAbono, cobro: { ...cmdAbono.cobro, id: cobroId } }).slice(0, 260));
if (!APPLY) { console.log('\nDRY-RUN. Aplicar con APPLY=1'); process.exit(0); }

for (const [i, payload] of [cmdRename, cmdPrice, cmdAbono].entries()) {
    const r = await fetch(`${url}/rest/v1/supervisor_commands`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
            monitor_device_id: monitor,
            primary_device_id: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
            command_type: 'inventory_update', status: 'pending',
            payload,
        }),
    });
    console.log(`enqueue #${i + 1} (${payload.action}):`, r.status, r.ok ? 'ok' : await r.text());
}
