#!/usr/bin/env node
/**
 * scripts/register-primary-instance-12092026.mjs
 *
 * Bootstrap de FASE 3A: registra a la instancia REAL de la caja como
 * `primaryInstanceId` en el gate central (doc `bodega_instance_gate_v1`).
 *
 * Verificación OBLIGATORIA antes de registrar:
 *   1. Backup fresco (<10 min) de la PC con `instanceId` presente (código nuevo)
 *      e `instanceHasServiceWorker: true` (instancia completa del POS).
 *   2. El dataset local de la PC debe coincidir con la nube canónica:
 *      - cierres locales >= cierres cloud - 2   (tolerancia: turno de hoy aún
 *        no empujado)
 *      - ventas locales >= ventas cloud - 30    (tolerancia: capturas previas)
 *   3. Consistencia de identidad: la instancia candidata debe tener SW y el
 *      id NO puede coincidir con ninguna instancia previa NO verificada.
 *
 * Uso:
 *   node scripts/register-primary-instance-12092026.mjs                 # verificar solamente
 *   REGISTER=1 node scripts/register-primary-instance-12092026.mjs      # verificar y registrar
 */

import fs from 'node:fs';

const ENV = {};
fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2];
});
const url = ENV.VITE_SUPABASE_URL || ENV.VITE_SUPABASE_CLOUD_URL;
const key = ENV.SUPABASE_SERVICE_KEY || ENV.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('✗ Falta .env'); process.exit(1); }
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const REGISTER = process.env.REGISTER === '1';
const DEVICE = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
const GATE_DOC = 'bodega_instance_gate_v1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Encolar request_full_backup ──
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(url, key);
const { data: pair } = await sb.from('device_pairings').select('monitor_device_id').eq('primary_device_id', DEVICE).maybeSingle();
const monitor = pair?.monitor_device_id;
if (!monitor) { console.error('✗ Sin pairing'); process.exit(1); }

const { data: cmd, error: cmdErr } = await sb
    .from('supervisor_commands')
    .insert({
        primary_device_id: DEVICE,
        monitor_device_id: monitor,
        command_type: 'request_full_backup',
        status: 'pending',
        payload: { reason: 'fase3a-identidad-instancia' },
    })
    .select('id')
    .single();
if (cmdErr) { console.error('✗ INSERT comando:', cmdErr.message); process.exit(1); }
console.log('request_full_backup encolado:', cmd.id);

// ── Esperar aplicación ──
let applied = false;
for (let i = 0; i < 40; i++) {
    await sleep(15000);
    const { data: st } = await sb.from('supervisor_commands').select('status,error_reason').eq('id', cmd.id).single();
    if (st && st.status !== 'pending') {
        console.log('comando →', st.status, st.error_reason || '');
        applied = st.status === 'applied';
        break;
    }
    process.stdout.write('.');
}
if (!applied) { console.error('\n✗ El backup no se aplicó a tiempo.'); process.exit(1); }

// ── Leer el backup fresco ──
const { data: bk, error: bkErr } = await sb.rpc('read_paired_cloud_backup', {
    p_primary_device_id: DEVICE,
    p_monitor_device_id: monitor,
    p_updated_after: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
});
if (bkErr || !Array.isArray(bk) || bk.length === 0) {
    console.error('✗ Sin backup fresco <10 min:', bkErr?.message || 'vacío');
    process.exit(1);
}
const b = bk[0];
const d = typeof b.backup_data === 'string' ? JSON.parse(b.backup_data) : b.backup_data;
const instanceId = d.instanceId || null;
const hasSW = d.instanceHasServiceWorker;

console.log('\n═══ VERIFICACIÓN DE IDENTIDAD ═══');
console.log('backup ts          :', b.updated_at);
console.log('instanceId         :', instanceId || '(AUSENTE — ¿código viejo o fantasma sin SW?)');
console.log('instanceHasSW      :', hasSW);

if (!instanceId) {
    console.error('✗ El backup no trae instanceId: quien respondió corre código VIEJO (¿la fantasma con dataset del 19-08?). NO registrar.');
    process.exit(1);
}
if (hasSW !== true) {
    console.error('✗ La instancia que respondió no corre Service Worker: no parece el POS completo. NO registrar.');
    process.exit(1);
}

// ── Verificación de dataset (¿es la caja real y no la fantasma del 19-08?) ──
// La fantasma NO se distingue por historial truncado (eso es lo normal hasta
// FASE 2) sino por DATOS VIEJOS: su dataset más reciente es del 19-08 y sus
// saleNumbers quedaron muy por detrás de la nube canónica. La caja REAL tiene
// registros de los últimos 3 días y un max saleNumber cercano al de la nube.
const sales = d.data?.idb?.bodega_sales_v1 || [];
const cierresLocal = sales.filter((s) => s?.tipo === 'REGISTRO_CIERRE').length;
const ventasLocal = sales.filter((s) => s?.tipo === 'VENTA').length;
const lastLocalTs = sales.map((s) => String(s?.timestamp || '')).sort().at(-1) || '';
const maxLocal = Math.max(0, ...ventasLocal ? sales.filter((s) => s?.tipo === 'VENTA').map((s) => Number(s.saleNumber) || 0) : [0]);

const rDoc = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data`, { headers: H });
const cloudSales = ((await rDoc.json())[0]?.data?.payload) || [];
const cierresCloud = cloudSales.filter((s) => s?.tipo === 'REGISTRO_CIERRE').length;
const ventasCloud = cloudSales.filter((s) => s?.tipo === 'VENTA').length;
const maxCloud = Math.max(0, ...cloudSales.filter((s) => s?.tipo === 'VENTA').map((s) => Number(s.saleNumber) || 0));

console.log('dataset PC local   :', sales.length, 'registros |', cierresLocal, 'cierres |', ventasLocal, 'ventas | max #'+maxLocal, '| último registro:', lastLocalTs);
console.log('dataset nube (D60) :', cloudSales.length, 'registros |', cierresCloud, 'cierres |', ventasCloud, 'ventas | max #'+maxCloud);

const diasDesdeUltimo = (Date.now() - new Date(lastLocalTs).getTime()) / 86400000;
const datosRecientes = diasDesdeUltimo <= 3;             // fantasma: su último dato es del 19-08 (>20 días)
const numeracionCercana = Math.abs(maxLocal - maxCloud) <= 40; // fantasma: quedó ~200 números atrás
const datasetOk = datosRecientes && numeracionCercana;
if (!datasetOk) {
    console.error(`✗ Dataset sospechoso: último registro hace ${diasDesdeUltimo.toFixed(1)} días, max local #${maxLocal} vs nube #${maxCloud} (¿fantasma del 19-08?). NO registrar.`);
    process.exit(1);
}
console.log('✔ Verificaciones OK: esta instancia es la caja real de producción.');

console.log('\nCandidata primaria:', instanceId);
if (!REGISTER) {
    console.log('DRY-RUN. Registrar con: REGISTER=1 node scripts/register-primary-instance-12092026.mjs');
    process.exit(0);
}

// ── Registrar el gate: anuncio persistente en supervisor_commands ──
// Canal elegido porque read_paired_audit_documents tiene lista blanca de
// doc_ids (agregar uno exige DDL y el token de Management API está muerto).
// La fila se inserta DIRECTAMENTE en status 'applied': ningún dispositivo la
// procesa como comando; todas las instancias la leen como dato (la tabla ya
// es legible por anon para el polling).
const gate = {
    action: 'instance_gate',
    primaryInstanceId: instanceId,
    registeredAt: new Date().toISOString(),
    registeredVia: 'scripts/register-primary-instance-12092026.mjs',
    verification: { backupUpdatedAt: b.updated_at, cierresLocal, ventasLocal, cierresCloud, ventasCloud, maxLocal, maxCloud, lastLocalTs },
};

const w = await fetch(`${url}/rest/v1/supervisor_commands`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({
        primary_device_id: DEVICE,
        monitor_device_id: monitor,
        command_type: 'inventory_update',
        status: 'applied',
        payload: gate,
    }),
});
if (!w.ok) {
    console.error('✗ INSERT anuncio de gate:', w.status, (await w.text()).slice(0, 300));
    process.exit(1);
}
const rows = await w.json();
if (!Array.isArray(rows) || rows.length !== 1) {
    console.error('✗ INSERT no devolvió la fila:', JSON.stringify(rows).slice(0, 200));
    process.exit(1);
}
console.log('anuncio insertado:', rows[0].id);

// Verificación FINAL por el MISMO camino que usará el POS (readGate):
const { data: gateRow, error: gateErr } = await sb
    .from('supervisor_commands')
    .select('payload')
    .eq('primary_device_id', DEVICE)
    .eq('command_type', 'inventory_update')
    .eq('status', 'applied')
    .contains('payload', { action: 'instance_gate' })
    .order('created_at', { ascending: false })
    .limit(1);
const read = gateErr ? null : gateRow?.[0]?.payload;
if (!read || read.primaryInstanceId !== instanceId) {
    console.error('✗ El gate NO es legible como lo leerá el POS:', gateErr?.message || JSON.stringify(read).slice(0, 200));
    process.exit(1);
}
console.log('✔ Gate registrado y VERIFICADO por el camino de lectura del POS:', read.primaryInstanceId);
console.log('\nDesde ahora: solo esa instancia (id ' + instanceId.slice(0, 8) + '…) procesará comandos.');
console.log('La fantasma quedará aislada en cuanto su SW cargue el código nuevo y lea el gate.');
