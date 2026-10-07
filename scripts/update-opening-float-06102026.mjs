#!/usr/bin/env node
/**
 * scripts/update-opening-float-06102026.mjs
 *
 * Actualiza el fondo inicial de la apertura activa de hoy (apertura_1791240900000):
 * - openingBs: 11.450,00 Bs
 * - openingUsd: $7.00 USD
 *
 * Cuadre resultante:
 * - 11.450 Bs + 2.080 Bs = 13.530,00 Bs exactos
 * - $7.00 USD + $0.00 USD = $7.00 USD exactos
 */

import fs from 'node:fs';

const ENV = {};
fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2];
});

const url = ENV.VITE_SUPABASE_URL || ENV.VITE_SUPABASE_CLOUD_URL;
const key = ENV.SUPABASE_SERVICE_KEY || ENV.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
    console.error('✗ Falta configuración en .env');
    process.exit(1);
}
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

console.log('═'.repeat(70));
console.log('ACTUALIZACIÓN DE FONDO INICIAL DE APERTURA (06-10-2026)');
console.log('═'.repeat(70));

// 1. Leer Doc 60
const r = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
if (!r.ok) {
    console.error('✗ Error leyendo Doc 60:', r.status);
    process.exit(1);
}
const doc = (await r.json())[0];
const sales = doc.data?.payload || [];
console.log(`Doc 60: ${sales.length} registros existentes`);

// 2. Snapshot de seguridad
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const snapPath = `backups/snapshot-doc60-pre-float-update-${stamp}.json`;
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync(snapPath, JSON.stringify({ savedAt: new Date().toISOString(), docUpdated: doc.updated_at, payload: sales }, null, 1));
console.log(`Snapshot de seguridad: ${snapPath}`);

// 3. Buscar apertura activa
const apIdx = sales.findIndex(s => s && s.id === 'apertura_1791240900000');
if (apIdx === -1) {
    console.error('✗ No se encontró la apertura apertura_1791240900000');
    process.exit(1);
}

const ap = sales[apIdx];
const now = new Date().toISOString();
const updatedApertura = {
    ...ap,
    openingBs: 11450,
    openingUsd: 7,
    openingCop: 0,
    updatedAt: now,
    _nota: 'Fondo inicial configurado a 11.450 Bs y $7.00 USD para cuadre exacto de 13.530 Bs y $7 USD'
};

const nextSales = [...sales];
nextSales[apIdx] = updatedApertura;

// 4. Actualizar en Supabase
console.log('\nAplicando cambios a Supabase Doc 60...');
const pr = await fetch(`${url}/rest/v1/sync_documents?id=eq.60`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({
        data: { payload: nextSales },
        updated_at: now
    })
});

if (!pr.ok) {
    console.error(`✗ Error ${pr.status}:`, (await pr.text()).slice(0, 300));
    process.exit(1);
}

// 5. Verificación post-escritura
const r2 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
const doc2 = (await r2.json())[0];
const sales2 = doc2.data?.payload || [];
const apCheck = sales2.find(s => s && s.id === 'apertura_1791240900000');

console.log('═'.repeat(70));
console.log('VERIFICACIÓN EXITOSA ✔');
console.log(`- Apertura ID: ${apCheck.id}`);
console.log(`- Fondo en Bolívares: ${apCheck.openingBs.toLocaleString('es-VE')} Bs`);
console.log(`- Fondo en Dólares: $${apCheck.openingUsd.toFixed(2)} USD`);
console.log(`- Estado: ${apCheck.cajaCerrada ? 'Cerrada' : 'Abierta (Turno Activo)'}`);
console.log(`- Total registros: ${sales2.length}`);
console.log('═'.repeat(70));
