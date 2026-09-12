#!/usr/bin/env node
/**
 * scripts/fiadas-jose-gregorio-11092026.mjs
 * Encola las dos ventas fiadas faltantes en el historial de jose gregorio
 * (CLI-00011): NELLY 250gr ($2.50) y Malta Retornable ($0.87) → $3.37.
 * El saldo (deuda 17.45) ya está correcto; esto añade los registros VENTA_FIADA
 * para que la deuda sea trazable. DRY-RUN por defecto (APPLY=1).
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

const DEVICE = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
const CLI11 = '733d1603-5672-4dec-8f40-79aa572f5d5a';
const TASA = 940;

// Next saleNumber desde Doc 60 (actualmente 801)
const r60 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data`, { headers: G });
const sales60 = ((await r60.json())[0].data.payload) || [];
let sn = Math.max(...sales60.map(s => s.saleNumber || 0), 0);
console.log('max saleNumber Doc60:', sn);

const mkFiada = (items, ts) => {
    sn += 1;
    const totalUsd = Math.round(items.reduce((a, i) => a + i.qty * i.priceUsd, 0) * 100) / 100;
    return {
        id: crypto.randomUUID(),
        timestamp: ts, createdAt: ts, updatedAt: ts,
        usuarioId: null, usuarioNombre: 'Supervisor', usuarioRol: 'SUPERVISOR',
        actor: { id: null, nombre: 'Supervisor', rol: 'SUPERVISOR' },
        deviceId: DEVICE,
        tipo: 'VENTA_FIADA',
        saleNumber: sn,
        rate: TASA,
        status: 'COMPLETADA',
        clienteId: CLI11,
        clienteName: 'jose gregorio',
        totalBs: Math.round(totalUsd * TASA * 100) / 100,
        totalUsd,
        fiadoUsd: totalUsd,
        vueltoParaMonedero: 0,
        customerId: CLI11,
        customerName: 'jose gregorio',
        items,
        nota: 'Carga remota autorizada por el supervisor (deuda fiada registrada)',
        _origen: 'comando_supervisor',
    };
};

const fiadaMargarina = mkFiada(
    [{ name: 'Margarina Nelly 250gr', qty: 1, priceUsd: 2.5, costBs: 0 }],
    '2026-09-12T01:30:00.000Z'
);
const fiadaMalta = mkFiada(
    [{ name: 'Malta Retornable', qty: 1, priceUsd: 0.87, costBs: 0 }],
    '2026-09-12T01:32:00.000Z'
);

const payload = {
    action: 'register_customer_payment',
    customerId: CLI11,
    customerCode: 'CLI-00011',
    // El saldo ya es correcto (17.45): se reenvía explícito para blindar idempotencia.
    deuda: 17.45, favor: 0,
    creditos: [fiadaMargarina, fiadaMalta],
    autorizado_por: 'supervisor',
    nota: 'Historial jose gregorio: registrar fiadas de Nelly 250gr (2.50) y Malta Retornable (0.87) = 3.37',
};

console.log('FIADA 1:', JSON.stringify({ sn: fiadaMargarina.saleNumber, totalUsd: fiadaMargarina.totalUsd, totalBs: fiadaMargarina.totalBs, items: fiadaMargarina.items }));
console.log('FIADA 2:', JSON.stringify({ sn: fiadaMalta.saleNumber, totalUsd: fiadaMalta.totalUsd, totalBs: fiadaMalta.totalBs, items: fiadaMalta.items }));
if (!APPLY) { console.log('\nDRY-RUN. Aplicar con APPLY=1'); process.exit(0); }

const r0 = await fetch(`${url}/rest/v1/supervisor_commands?monitor_device_id=not.is.null&order=created_at.desc&limit=1&select=monitor_device_id`, { headers: G });
const monitor = (await r0.json())[0]?.monitor_device_id;
const r = await fetch(`${url}/rest/v1/supervisor_commands`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ monitor_device_id: monitor, primary_device_id: DEVICE, command_type: 'inventory_update', status: 'pending', payload }),
});
console.log('enqueue:', r.status, r.ok ? 'ok' : await r.text());
