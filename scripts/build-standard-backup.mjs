import fs from 'node:fs';
import path from 'node:path';
import { IDB_KEYS, LS_KEYS } from '../src/config/backupKeys.js';

function main() {
    const outDir = path.resolve(process.cwd(), 'backups_extracted');
    const snapshotPath = path.join(outDir, 'sync_snapshot_PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F_latest.json');
    const cloudBackupPath = path.join(outDir, 'cloud_backup_PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F_2026-09-13T07-28-38-298948+00-00.json');

    if (!fs.existsSync(snapshotPath)) {
        console.error('Snapshot file not found:', snapshotPath);
        return;
    }

    const liveSnapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    let fallbackBackup = null;
    if (fs.existsSync(cloudBackupPath)) {
        fallbackBackup = JSON.parse(fs.readFileSync(cloudBackupPath, 'utf8'));
    }

    const idbData = {};
    const lsData = {};

    // 1. Populate IDB keys: prioritize live sync documents, fallback to cloud_backup if not in sync_documents
    for (const key of IDB_KEYS) {
        if (liveSnapshot.collections.store[key] !== undefined) {
            idbData[key] = liveSnapshot.collections.store[key];
        } else if (fallbackBackup?.data?.idb?.[key] !== undefined) {
            idbData[key] = fallbackBackup.data.idb[key];
        }
    }

    // Also include any extra keys present in live sync store
    for (const [key, val] of Object.entries(liveSnapshot.collections.store)) {
        if (idbData[key] === undefined) {
            idbData[key] = val;
        }
    }

    // 2. Populate LS keys
    for (const key of LS_KEYS) {
        if (liveSnapshot.collections.local[key] !== undefined) {
            lsData[key] = typeof liveSnapshot.collections.local[key] === 'object'
                ? JSON.stringify(liveSnapshot.collections.local[key])
                : String(liveSnapshot.collections.local[key]);
        } else if (fallbackBackup?.data?.ls?.[key] !== undefined) {
            lsData[key] = fallbackBackup.data.ls[key];
        }
    }

    for (const [key, val] of Object.entries(liveSnapshot.collections.local)) {
        if (lsData[key] === undefined) {
            lsData[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
        }
    }

    const standardBackup = {
        timestamp: new Date().toISOString(),
        version: '2.0',
        appName: 'TasasAlDia_Bodegas',
        source: 'Supabase Cloud Sync (PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F)',
        data: {
            idb: idbData,
            ls: lsData
        }
    };

    const finalBackupPath = path.join(outDir, `backup_dondejuancho_cloud_latest_${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(finalBackupPath, JSON.stringify(standardBackup, null, 2), 'utf8');

    console.log('\n======================================================');
    console.log('✅ RESPALDO ESTÁNDAR GENERADO CON ÉXITO');
    console.log('======================================================');
    console.log(`Ruta del archivo: ${finalBackupPath}`);
    console.log(`Tamaño: ${(fs.statSync(finalBackupPath).size / 1024).toFixed(2)} KB`);
    console.log(`Versión: ${standardBackup.version}`);
    console.log(`Total colecciones IDB: ${Object.keys(idbData).length}`);
    console.log(`Total configuraciones LS: ${Object.keys(lsData).length}`);
    console.log(`- Ventas en IDB: ${idbData.bodega_sales_v1?.length || 0}`);
    console.log(`- Productos en IDB: ${idbData.bodega_products_v1?.length || 0}`);
    console.log(`- Clientes en IDB: ${idbData.bodega_customers_v1?.length || 0}`);
    console.log(`- Kardex en IDB: ${idbData.bodega_kardex_v1?.length || 0}`);
    console.log(`- Empleados: ${idbData.bodega_employees_v1?.length || 0}`);
    console.log(`- Proveedores: ${idbData.bodega_suppliers_v1?.length || 0}`);
    console.log(`- Categorías: ${idbData.my_categories_v1?.length || 0}`);
    console.log(`- Métodos de pago: ${idbData.bodega_payment_methods_v1?.length || 0}`);
    console.log('======================================================\n');
}

main();
