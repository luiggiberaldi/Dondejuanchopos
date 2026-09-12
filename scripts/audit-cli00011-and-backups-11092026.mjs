#!/usr/bin/env node
/**
 * scripts/audit-cli00011-and-backups-11092026.mjs  (READ-ONLY)
 * - Estado exacto del comando supervisor d0a94c27 (CLI-00011).
 * - Todos los comandos update_customer_balance.
 * - Comandos fallidos de hoy.
 * - Último cloud_backup del dispositivo autoritativo (¿contiene el cierre errado 0.71 y las ventas de hoy?).
 * NO ESCRIBE NADA.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEVICE_ID = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';

function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return {};
    const env = {};
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const i = t.indexOf('=');
        if (i > -1) {
            let v = t.substring(i + 1).trim();
            if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
            env[t.substring(0, i).trim()] = v;
        }
    });
    return env;
}
const env = loadEnv();
const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_CLOUD_URL;
const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) { console.error('✗ Falta .env'); process.exit(1); }
const H = { apikey: key, Authorization: `Bearer ${key}` };

console.log(`\n════ AUDITORÍA COMANDOS + BACKUPS (READ-ONLY) ${new Date().toISOString()} ════\n`);

// 1. Comando d0a94c27 exacto
const r1 = await fetch(`${url}/rest/v1/supervisor_commands?id=eq.d0a94c27-bd0f-445a-885c-4b984370768f&select=id,command_type,status,error_reason,created_at,applied_at,payload`, { headers: H });
const cmd = (r1.ok ? await r1.json() : [])[0];
if (cmd) {
    console.log(`COMANDO d0a94c27 (CLI-00011):`);
    console.log(`  status=${cmd.status} | type=${cmd.command_type} | creado=${cmd.created_at} | aplicado=${cmd.applied_at || 'NUNCA'}`);
    console.log(`  error=${cmd.error_reason || '—'}`);
    console.log(`  payload=${JSON.stringify(cmd.payload)?.slice(0, 400)}`);
} else {
    console.log('COMANDO d0a94c27: no existe en supervisor_commands');
}

// 2. Todos los update_customer_balance
const r2 = await fetch(`${url}/rest/v1/supervisor_commands?payload->>action=eq.update_customer_balance&select=id,status,error_reason,created_at,applied_at,payload&order=created_at.desc&limit=10`, { headers: H });
const balCmds = r2.ok ? await r2.json() : [];
console.log(`\nCOMANDOS update_customer_balance (${balCmds.length}):`);
balCmds.forEach(c => console.log(`  • [${c.status}] ${c.id.slice(0, 8)}… creado=${c.created_at} aplicado=${c.applied_at || '—'} ${c.error_reason ? `error=${c.error_reason}` : ''} → deuda=${c.payload?.deuda}, favor=${c.payload?.favor}, cust=${c.payload?.customerCode || c.payload?.customerId}`));

// 3. Fallidos hoy
const r3 = await fetch(`${url}/rest/v1/supervisor_commands?primary_device_id=eq.${DEVICE_ID}&status=eq.failed&select=id,command_type,status,error_reason,created_at&order=created_at.desc&limit=10`, { headers: H });
const failed = r3.ok ? await r3.json() : [];
console.log(`\nCOMANDOS FALLIDOS (últimos ${failed.length}):`);
failed.forEach(c => console.log(`  • ${c.created_at} | ${c.command_type} | ${c.error_reason}`));

// 4. cloud_backups del dispositivo
const r4 = await fetch(`${url}/rest/v1/cloud_backups?device_id=eq.${DEVICE_ID}&select=id,device_id,updated_at,created_at`, { headers: H });
const bups = r4.ok ? await r4.json() : [];
console.log(`\nCLOUD_BACKUPS del dispositivo (${bups.length}):`);
bups.forEach(b => console.log(`  • id=${b.id} updated_at=${b.updated_at || b.created_at}`));

if (bups.length > 0) {
    const bid = bups[0].id;
    const r5 = await fetch(`${url}/rest/v1/cloud_backups?id=eq.${bid}&select=data`, { headers: H });
    const blob = (r5.ok ? await r5.json() : [])[0];
    const data = blob?.data;
    if (data) {
        console.log(`\nContenido del último backup (id=${bid}):`);
        const keys = Object.keys(data || {});
        console.log(`  claves: ${keys.slice(0, 30).join(', ')}`);
        // Buscar el array de ventas dentro del blob
        const findSales = (obj, depth = 0) => {
            if (!obj || depth > 3) return null;
            if (Array.isArray(obj) && obj.some(x => x?.tipo === 'REGISTRO_CIERRE')) return obj;
            for (const k of Object.keys(obj || {})) {
                const found = findSales(obj[k], depth + 1);
                if (found) return found;
            }
            return null;
        };
        const sales = findSales(data);
        if (Array.isArray(sales)) {
            const cierres = sales.filter(s => s?.tipo === 'REGISTRO_CIERRE');
            const aperturas = sales.filter(s => s?.tipo === 'APERTURA_CAJA');
            const lastCierre = [...cierres].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0];
            const lastAper = [...aperturas].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))[0];
            console.log(`  VENTAS en backup: ${sales.length} registros | ${cierres.length} cierres | ${aperturas.length} aperturas`);
            if (lastCierre) {
                const sum = lastCierre.summary || {};
                console.log(`  ÚLTIMO CIERRE en backup: cierreId=${lastCierre.cierreId} ts=${lastCierre.timestamp} vendidoUsd=${sum.todayTotalUsd} vendidoBs=${sum.todayTotalBs} items=${sum.todayItemsSold}`);
            }
            if (lastAper) console.log(`  ÚLTIMA APERTURA en backup: ${lastAper.id} ts=${lastAper.timestamp} openingBs=${lastAper.openingBs} cajaCerrada=${lastAper.cajaCerrada}`);
            const hoy = sales.filter(s => (s.timestamp || '').startsWith('2026-09-11'));
            console.log(`  MOVIMIENTOS de hoy (2026-09-11) en backup: ${hoy.length}`);
            hoy.slice(0, 12).forEach(s => console.log(`    • ${s.tipo} ${s.saleNumber ? '#' + s.saleNumber : ''} | ${s.timestamp} | Bs ${s.totalBs ?? s.montoBs ?? ''} | ${(s.payments || []).map(p => p.methodId).join('+') || s.paymentMethod || ''}`));
            // Cierre #40 o cierre con 0.71
            const cierreErrado = cierres.find(c => (c.summary?.todayTotalUsd === 0.71) || (c.cierreId && !['1789067577320'].includes(String(c.cierreId))));
            console.log(`  ¿Cierre errado ($0.71) presente en backup? ${cierreErrado ? `SÍ → cierreId=${cierreErrado.cierreId} ts=${cierreErrado.timestamp}` : 'NO'}`);
        } else {
            console.log('  (No se encontró array de ventas en el blob del backup)');
        }
        // Clientes en backup
        const findCustomers = (obj, depth = 0) => {
            if (!obj || depth > 3) return null;
            if (Array.isArray(obj) && obj.some(x => x?.code && String(x.code).startsWith('CLI-'))) return obj;
            for (const k of Object.keys(obj || {})) {
                const found = findCustomers(obj[k], depth + 1);
                if (found) return found;
            }
            return null;
        };
        const customers = findCustomers(data);
        if (Array.isArray(customers)) {
            const cli = customers.find(c => c?.code === 'CLI-00011' || c?.id === '733d1603-5672-4dec-8f40-79aa572f5d5a');
            if (cli) console.log(`  CLI-00011 en backup: "${cli.name}" deuda=$${cli.deuda} favor=$${cli.favor} updatedAt=${cli.updatedAt || '—'}`);
        }
    } else {
        console.log('  (backup sin data)');
    }
}
console.log(`\n════ FIN (nada fue modificado) ════\n`);
