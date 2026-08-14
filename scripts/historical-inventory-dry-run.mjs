#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildHistoricalInventoryCsv, buildHistoricalInventoryDryRun } from '../src/utils/historicalInventoryReconciliation.js';

function findCollection(value, key, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            const result = findCollection(item, key, seen);
            if (result) return result;
        }
        return null;
    }

    if (Array.isArray(value[key])) return value[key];
    for (const child of Object.values(value)) {
        const result = findCollection(child, key, seen);
        if (result) return result;
    }
    return null;
}

function outputPaths(inputPath, outputBase) {
    const base = outputBase || inputPath.replace(/\.json$/i, '') + '_inventario_dry_run';
    const withoutKnownExtension = base.replace(/\.(json|csv)$/i, '');
    return {
        json: `${withoutKnownExtension}.json`,
        csv: `${withoutKnownExtension}.csv`,
    };
}

async function main() {
    const [inputArg, outputArg] = process.argv.slice(2);
    if (!inputArg) {
        console.error('Uso: bun scripts/historical-inventory-dry-run.mjs <backup.json> [salida_sin_extension]');
        process.exitCode = 1;
        return;
    }

    const inputPath = path.resolve(inputArg);
    const raw = await readFile(inputPath, 'utf8');
    const backup = JSON.parse(raw);
    const collection = key => findCollection(backup, key) || [];
    const missingDocIds = [];

    for (const key of ['bodega_products_v1', 'bodega_sales_v1', 'bodega_kardex_v1']) {
        if (!findCollection(backup, key)) missingDocIds.push(key);
    }
    for (const key of ['bodega_kardex_snapshots_v1', 'bodega_inventory_operations_v1']) {
        const value = findCollection(backup, key);
        if (!Array.isArray(value) || value.length === 0) missingDocIds.push(key);
    }

    const report = buildHistoricalInventoryDryRun({
        products: collection('bodega_products_v1'),
        sales: collection('bodega_sales_v1'),
        kardex: collection('bodega_kardex_v1'),
        operations: collection('bodega_inventory_operations_v1'),
        missingDocIds,
    });
    const paths = outputPaths(inputPath, outputArg && path.resolve(outputArg));

    await writeFile(paths.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(paths.csv, `\uFEFF${buildHistoricalInventoryCsv(report)}`, 'utf8');

    console.log(JSON.stringify({
        status: report.status,
        dryRun: report.dryRun,
        mutatesData: report.mutatesData,
        summary: report.summary,
        missingDocIds: report.sourceCoverage.missingDocIds,
        files: paths,
    }, null, 2));
}

main().catch(error => {
    console.error(`[historical-inventory-dry-run] ${error.message}`);
    process.exitCode = 1;
});
