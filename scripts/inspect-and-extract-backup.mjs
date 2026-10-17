import fs from 'node:fs';
import path from 'node:path';
import { decompressString } from '../src/utils/compression.js';

function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env');
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
const H = { apikey: key, Authorization: `Bearer ${key}` };

async function main() {
    console.log('=== INSPECCIÓN Y EXTRACCIÓN DE RESPALDO ===\n');

    // 1. Inspect storage buckets
    try {
        const bRes = await fetch(`${url}/storage/v1/bucket`, { headers: H });
        if (bRes.ok) {
            const buckets = await bRes.json();
            console.log('Storage Buckets:', buckets.map(b => b.name));
            for (const b of buckets) {
                const listRes = await fetch(`${url}/storage/v1/object/list/${b.name}`, {
                    method: 'POST',
                    headers: { ...H, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prefix: '', limit: 100 })
                });
                if (listRes.ok) {
                    const files = await listRes.json();
                    console.log(`  Archivos en bucket '${b.name}':`, files.map(f => f.name));
                }
            }
        }
    } catch (e) {
        console.warn('Error checking storage:', e.message);
    }

    // 2. Inspect cloud_backups table
    console.log('\n--- Tabla cloud_backups ---');
    const cbRes = await fetch(`${url}/rest/v1/cloud_backups?select=*&order=updated_at.desc`, { headers: H });
    const cloudBackups = await cbRes.json();
    console.log(`Total rows in cloud_backups: ${cloudBackups.length}`);

    // Create a directory for extracted backups if it doesn't exist
    const outDir = path.resolve(process.cwd(), 'backups_extracted');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    for (let idx = 0; idx < cloudBackups.length; idx++) {
        const cb = cloudBackups[idx];
        console.log(`\nRespaldo [${idx + 1}]: ID ${cb.id} | Device: ${cb.device_id} | Updated: ${cb.updated_at}`);
        let backupData = cb.backup_data;
        if (backupData?.compressed) {
            console.log('  -> El backup está comprimido. Descomprimiendo...');
            try {
                const decompressed = await decompressString(backupData.data);
                backupData = JSON.parse(decompressed);
                console.log('  -> Descompresión exitosa!');
            } catch (err) {
                console.error('  -> Error descomprimiendo:', err.message);
            }
        }

        const keysInBackup = Object.keys(backupData?.data?.idb || backupData?.data || backupData || {});
        console.log(`  -> Claves principales en backup:`, keysInBackup);
        if (backupData?.data?.idb?.bodega_sales_v1) {
            console.log(`  -> Total ventas en idb:`, backupData.data.idb.bodega_sales_v1.length);
        }
        if (backupData?.data?.idb?.bodega_products_v1) {
            console.log(`  -> Total productos en idb:`, backupData.data.idb.bodega_products_v1.length);
        }

        const filename = `cloud_backup_${cb.device_id.replace(/[^a-zA-Z0-9_-]/g, '_')}_${cb.updated_at.replace(/[:.]/g, '-')}.json`;
        const filePath = path.join(outDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2), 'utf8');
        console.log(`  -> Guardado en: ${filePath}`);
    }

    // 3. Inspect sync_documents (which has live data from today!)
    console.log('\n--- Tabla sync_documents (Estado en vivo de la nube) ---');
    const sdRes = await fetch(`${url}/rest/v1/sync_documents?select=device_id,collection,doc_id,updated_at&order=updated_at.desc&limit=50`, { headers: H });
    const syncDocs = await sdRes.json();
    console.log(`Documentos sincronizados recientes (${syncDocs.length}):`);
    
    // Group by device
    const byDevice = {};
    syncDocs.forEach(d => {
        if (!byDevice[d.device_id]) byDevice[d.device_id] = [];
        byDevice[d.device_id].push({ doc: `${d.collection}:${d.doc_id}`, updated: d.updated_at });
    });
    for (const [dev, docs] of Object.entries(byDevice)) {
        console.log(`\nDispositivo: ${dev} (${docs.length} docs):`);
        docs.forEach(x => console.log(`  - ${x.doc} (${x.updated})`));
    }

    // Download full snapshot of sync_documents for the primary device (PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F)
    const primaryDevice = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';
    console.log(`\nExtrayendo estado completo de sync_documents para ${primaryDevice}...`);
    const fullSdRes = await fetch(`${url}/rest/v1/sync_documents?device_id=eq.${primaryDevice}&select=*`, { headers: H });
    if (fullSdRes.ok) {
        const fullDocs = await fullSdRes.json();
        console.log(`Total documentos descargados para ${primaryDevice}: ${fullDocs.length}`);
        
        const fullState = {
            extracted_at: new Date().toISOString(),
            device_id: primaryDevice,
            collections: {
                store: {},
                local: {}
            }
        };

        fullDocs.forEach(d => {
            const payload = d.data?.payload !== undefined ? d.data.payload : d.data;
            if (d.collection === 'store') {
                fullState.collections.store[d.doc_id] = payload;
            } else {
                fullState.collections.local[d.doc_id] = payload;
            }
        });

        const syncSnapshotPath = path.join(outDir, `sync_snapshot_${primaryDevice}_latest.json`);
        fs.writeFileSync(syncSnapshotPath, JSON.stringify(fullState, null, 2), 'utf8');
        console.log(`-> Guardado snapshot completo en vivo en: ${syncSnapshotPath}`);

        // Quick summary of live sync snapshot
        console.log('\nResumen del snapshot en vivo:');
        if (fullState.collections.store.bodega_sales_v1) {
            const sales = fullState.collections.store.bodega_sales_v1;
            console.log(`  - Ventas registradas: ${Array.isArray(sales) ? sales.length : 'objeto'}`);
            if (Array.isArray(sales) && sales.length > 0) {
                console.log(`    Primera venta: ${sales[sales.length - 1]?.saleNumber || sales[sales.length - 1]?.timestamp}`);
                console.log(`    Última venta: ${sales[0]?.saleNumber || sales[0]?.timestamp}`);
            }
        }
        if (fullState.collections.store.bodega_products_v1) {
            const prods = fullState.collections.store.bodega_products_v1;
            console.log(`  - Productos registrados: ${Array.isArray(prods) ? prods.length : 'objeto'}`);
        }
        if (fullState.collections.store.bodega_customers_v1) {
            const custs = fullState.collections.store.bodega_customers_v1;
            console.log(`  - Clientes registrados: ${Array.isArray(custs) ? custs.length : 'objeto'}`);
        }
        if (fullState.collections.store.bodega_kardex_v1) {
            const kardex = fullState.collections.store.bodega_kardex_v1;
            console.log(`  - Movimientos Kardex: ${Array.isArray(kardex) ? kardex.length : 'objeto'}`);
        }
    }
}

main().catch(console.error);
