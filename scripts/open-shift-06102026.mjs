#!/usr/bin/env node
/**
 * scripts/open-shift-06102026.mjs
 *
 * Registra formalmente la APERTURA_CAJA de la jornada del 06-10-2026 en Doc 60 (Supabase)
 * con fondo inicial en 0 (0 Bs, $0 USD, 0 COP) para el cajero Luis Medina,
 * fechada a las 17:35:00 UTC (1 minuto antes de la venta #1232).
 *
 * Esto permite que el Monitor del Supervisor reconozca inmediatamente el "Turno Activo"
 * y absorba las 12 ventas de hoy (#1232 a #1243, $19.94 USD / 19.175,38 Bs).
 *
 * Uso:
 *   node scripts/open-shift-06102026.mjs          (dry-run)
 *   APPLY=1 node scripts/open-shift-06102026.mjs  (aplicar a producción)
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
const APPLY = process.env.APPLY === '1';

console.log('═'.repeat(70));
console.log(`APERTURA DE TURNO EN PRODUCCIÓN (06-10-2026) — MODO: ${APPLY ? 'APLICAR' : 'DRY-RUN'}`);
console.log('═'.repeat(70));

// 1. Leer Doc 60
const r = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
if (!r.ok) {
    console.error('✗ Error leyendo Doc 60:', r.status, (await r.text()).slice(0, 200));
    process.exit(1);
}
const doc = (await r.json())[0];
const sales = doc.data?.payload || [];
console.log(`Doc 60: ${sales.length} registros existentes, updated_at=${doc.updated_at}`);

// 2. Snapshot previo de seguridad
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const snapPath = `backups/snapshot-doc60-pre-open-shift-${stamp}.json`;
fs.mkdirSync('backups', { recursive: true });
fs.writeFileSync(snapPath, JSON.stringify({ savedAt: new Date().toISOString(), docUpdated: doc.updated_at, payload: sales }, null, 1));
console.log(`Snapshot previo guardado en: ${snapPath}`);

// 3. Verificar si ya existe una apertura abierta
const openAperturaExistente = sales.find(s => s && s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
if (openAperturaExistente) {
    console.log('⚠ YA EXISTE una apertura abierta en Doc 60:', openAperturaExistente);
    process.exit(0);
}

// 4. Crear el registro de APERTURA_CAJA
const now = new Date().toISOString();
const nuevaApertura = {
    id: 'apertura_1791240900000',
    tipo: 'APERTURA_CAJA',
    openingUsd: 0,
    openingBs: 0,
    openingCop: 0,
    cajero: 'Luis Medina',
    cajeroId: 2,
    timestamp: '2026-10-06T17:35:00.000Z',
    createdAt: '2026-10-06T17:35:00.000Z',
    updatedAt: now,
    cajaCerrada: false,
    _nota: 'Apertura formal de jornada 06-10-2026 en 0 Bs / $0 USD (activación de turno activo)'
};

console.log('\nNueva APERTURA_CAJA a insertar:');
console.log(JSON.stringify(nuevaApertura, null, 2));

// 5. Insertar nueva apertura manteniendo la lista
const nextSales = [nuevaApertura, ...sales];

// 6. Verificar movimientos del turno con esta apertura
const apTs = new Date(nuevaApertura.timestamp).getTime();
const shiftSales = nextSales.filter(s => {
    if (s.cajaCerrada === true) return false;
    if (!['VENTA', 'VENTA_FIADA', 'COBRO_DEUDA'].includes(s.tipo)) return false;
    const ts = new Date(s.timestamp || s.createdAt || 0).getTime();
    return ts >= apTs;
});

const totalUsd = shiftSales.reduce((sum, s) => sum + (Number(s.totalUsd) || 0), 0);
const totalBs = shiftSales.reduce((sum, s) => sum + (Number(s.totalBs) || 0), 0);

console.log('\n--- PROYECCIÓN DEL TURNO TRAS APERTURA ---');
console.log(`Ventas absorbidas en el turno activo: ${shiftSales.length}`);
console.log(`Venta inicial: #${shiftSales[shiftSales.length - 1]?.saleNumber} (${shiftSales[shiftSales.length - 1]?.timestamp})`);
console.log(`Última venta: #${shiftSales[0]?.saleNumber} (${shiftSales[0]?.timestamp})`);
console.log(`Total Vendido USD: $${totalUsd.toFixed(2)}`);
console.log(`Total Vendido BS: ${totalBs.toFixed(2)} Bs`);

if (!APPLY) {
    console.log('\n[DRY-RUN COMPLETADO]. Para aplicar los cambios a producción, ejecuta con APPLY=1');
    process.exit(0);
}

// 7. Aplicar a Supabase
console.log('\nGuardando en Doc 60 en Supabase...');
const patchRes = await fetch(`${url}/rest/v1/sync_documents?id=eq.60`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({
        data: { payload: nextSales },
        updated_at: now
    })
});

if (!patchRes.ok) {
    console.error(`✗ ERROR ${patchRes.status}:`, (await patchRes.text()).slice(0, 300));
    process.exit(1);
}
console.log(`✔ Doc 60 actualizado con éxito (${nextSales.length} registros).`);

// 8. Verificación post-escritura
console.log('\nVerificando re-lectura en vivo desde Supabase...');
const r2 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data,updated_at`, { headers: H });
const doc2 = (await r2.json())[0];
const sales2 = doc2.data?.payload || [];

const apCheck = sales2.find(s => s && s.id === 'apertura_1791240900000');
if (!apCheck || apCheck.cajaCerrada) {
    console.error('✗ Fallo de verificación: la apertura no se encuentra abierta.');
    process.exit(1);
}

const cierresCount = sales2.filter(s => s && s.tipo === 'REGISTRO_CIERRE').length;
console.log('═'.repeat(70));
console.log('VERIFICACIÓN POST-APERTURA EXITOSA ✔');
console.log(`- Registros totales: ${sales2.length} (antes ${sales.length})`);
console.log(`- Apertura activa confirmada: ID=${apCheck.id}, Cajero=${apCheck.cajero}, cajaCerrada=${apCheck.cajaCerrada}`);
console.log(`- Cierres históricos intactos: ${cierresCount} cierres`);
console.log('═'.repeat(70));
process.exit(0);
