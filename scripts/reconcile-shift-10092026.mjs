#!/usr/bin/env node
/**
 * scripts/reconcile-shift-10092026.mjs
 *
 * Script de Restauración y Salvaguarda Contable para la Jornada 10-09-2026 (Donde Juancho POS).
 * Dispositivo Autoritativo: PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F (Doc ID 60 en sync_documents).
 *
 * Datos canónicos inmutables de la jornada:
 * - Apertura: 9.980,00 Bs y $33,00 USD (Luis Medina, 12:11 PM).
 * - Ventas (8 transacciones = 15.350,00 Bs / ~$16,50 USD):
 *   1. Venta #785: 6 Polar Light Lata Grande = 5.550,00 Bs ($5.95) [Pago Móvil]
 *   2. Venta #786: 1 Glup 1L = 660,00 Bs ($0.71) [Punto de Venta]
 *   3. Venta #787: 4 Lucky Strike = 880,00 Bs ($0.95) [Punto de Venta]
 *   4. Venta #788: 2 Chupetas Bon Bon Bum = 440,00 Bs ($0.47) [Punto de Venta]
 *   5. Venta #789: 1 Cheese Tris 50g = 1.210,00 Bs ($1.30) [Punto de Venta]
 *   6. Venta #790: 2 Gomitas SH = 200,00 Bs ($0.22) [Punto de Venta]
 *   7. Venta #791: 6 Solera Lata pequeña = 6.280,00 Bs ($6.75) [Punto de Venta]
 *   8. Venta #792: 1 Viceroy = 130,00 Bs ($0.14) [Efectivo Bs]
 * - Gasto Interno:
 *   - Compra de teipe = 1.700,00 Bs en efectivo (egreso de gaveta).
 * - Arqueo de Dinero en Gaveta (Cuadre 100% exacto):
 *   - Efectivo Bs: 9.980 - 1.700 + 130 = 8.410,00 Bs
 *   - Dólares: $33,00 USD
 *   - Punto de Venta: 9.670,00 Bs
 *   - Pago Móvil: 5.550,00 Bs
 * - Cierres Históricos: 40 cierres (REGISTRO_CIERRE #1 al #39).
 */

import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, 'utf8');
    const env = {};
    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const idx = trimmed.indexOf('=');
        if (idx > -1) {
            let val = trimmed.substring(idx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            env[trimmed.substring(0, idx).trim()] = val;
        }
    });
    return env;
}

export const CANONICAL_SHIFT_10092026 = [
    {
        id: 'sale_manual_100926_792',
        saleNumber: 792,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T20:00:00.000Z',
        createdAt: '2026-09-10T20:00:00.000Z',
        updatedAt: '2026-09-10T20:00:00.000Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        cajero: 'Luis Medina',
        cajeroId: 2,
        customerName: 'Consumidor Final',
        totalBs: 130,
        totalUsd: 0.14,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_64', name: 'Vicerroy', qty: 1, priceUsd: 0.14, subtotalBs: 130 }],
        payments: [{ isCash: true, amountBs: 130, amountUsd: 0.14, currency: 'BS', methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs' }]
    },
    {
        id: 'sale_manual_100926_791',
        saleNumber: 791,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:55:00.000Z',
        createdAt: '2026-09-10T19:55:00.000Z',
        updatedAt: '2026-09-10T19:55:00.000Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        cajero: 'Luis Medina',
        cajeroId: 2,
        customerName: 'Consumidor Final',
        totalBs: 6280,
        totalUsd: 6.75,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_17', name: 'Solera Lata pequeña', qty: 6, priceUsd: 1.125, subtotalBs: 6280 }],
        payments: [{ isCash: false, amountBs: 6280, amountUsd: 6.75, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    },
    {
        id: 'sale_manual_100926_790',
        saleNumber: 790,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:50:00.000Z',
        createdAt: '2026-09-10T19:50:00.000Z',
        updatedAt: '2026-09-10T19:50:00.000Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        cajero: 'Luis Medina',
        cajeroId: 2,
        customerName: 'Consumidor Final',
        totalBs: 200,
        totalUsd: 0.22,
        rate: 930,
        items: [{ id: '927aba63-5c89-4f26-a75e-a4e37cdcc931', name: 'Gomitas super héroe', qty: 2, priceUsd: 0.11, subtotalBs: 200 }],
        payments: [{ isCash: false, amountBs: 200, amountUsd: 0.22, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    },
    {
        id: 'sale_manual_100926_789',
        saleNumber: 789,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:45:00.000Z',
        createdAt: '2026-09-10T19:45:00.000Z',
        updatedAt: '2026-09-10T19:45:00.000Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        cajero: 'Luis Medina',
        cajeroId: 2,
        customerName: 'Consumidor Final',
        totalBs: 1210,
        totalUsd: 1.30,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_47', name: 'Cheese Trees 50gr', qty: 1, priceUsd: 1.30, subtotalBs: 1210 }],
        payments: [{ isCash: false, amountBs: 1210, amountUsd: 1.30, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    },
    {
        id: 'sale_manual_100926_788',
        saleNumber: 788,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:40:00.000Z',
        createdAt: '2026-09-10T19:40:00.000Z',
        updatedAt: '2026-09-10T19:40:00.000Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        cajero: 'Luis Medina',
        cajeroId: 2,
        customerName: 'Consumidor Final',
        totalBs: 440,
        totalUsd: 0.47,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_44', name: 'Chupetas bom Bon bum', qty: 2, priceUsd: 0.235, subtotalBs: 440 }],
        payments: [{ isCash: false, amountBs: 440, amountUsd: 0.47, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    },
    {
        id: 'sale_manual_100926_787',
        saleNumber: 787,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:35:00.000Z',
        createdAt: '2026-09-10T19:35:00.000Z',
        updatedAt: '2026-09-10T19:35:00.000Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        cajero: 'Luis Medina',
        cajeroId: 2,
        customerName: 'Consumidor Final',
        totalBs: 880,
        totalUsd: 0.95,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_67', name: 'Lucky Strike', qty: 4, priceUsd: 0.2375, subtotalBs: 880 }],
        payments: [{ isCash: false, amountBs: 880, amountUsd: 0.95, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    },
    {
        id: '34bbf3f7-f655-4a08-936e-e7255e5aa408',
        saleNumber: 786,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:24:57.320Z',
        createdAt: '2026-09-10T19:24:57.320Z',
        updatedAt: '2026-09-10T19:24:57.320Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        cajero: 'Luis Medina',
        cajeroId: 2,
        customerName: 'Consumidor Final',
        totalBs: 660,
        totalUsd: 0.71,
        rate: 930,
        items: [{ id: 'prod_juancho_1783994743_12', name: 'Glup negro y sabores 1 Litro', qty: 1, priceUsd: 0.71, subtotalBs: 660 }],
        payments: [{ isCash: false, amountBs: 660, amountUsd: 0.71, currency: 'BS', methodId: 'punto_venta', methodLabel: 'Punto de Venta' }]
    },
    {
        id: 'gasto_teipe_1789067070525',
        tipo: 'GASTO_INTERNO',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T19:04:30.525Z',
        createdAt: '2026-09-10T19:04:30.525Z',
        updatedAt: '2026-09-10T19:04:30.525Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        cajero: 'Luis Medina',
        cajeroId: 2,
        motivo: 'Compra de teipe',
        categoria: 'materiales',
        montoBs: 1700,
        montoUsd: 1.83,
        totalBs: 1700,
        totalUsd: 1.83,
        moneda: 'BS',
        paymentMethod: 'efectivo_bs',
        afectaCaja: true
    },
    {
        id: '5403d7ca-02fb-4ff5-b65e-aaaa7efb3f4f',
        saleNumber: 785,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp: '2026-09-10T16:46:42.668Z',
        createdAt: '2026-09-10T16:46:42.668Z',
        updatedAt: '2026-09-10T16:46:42.668Z',
        cajaCerrada: false,
        deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
        cajero: 'Luis Medina',
        cajeroId: 2,
        cajeroRol: 'CAJERO',
        customerName: 'Consumidor Final',
        totalBs: 5550,
        totalUsd: 5.95,
        rate: 932.77,
        items: [{ id: 'prod_juancho_1783994743_5', name: 'Polar Light Lata Grande', qty: 6, priceUsd: 0.9916666, subtotalBs: 5550 }],
        payments: [{ isCash: false, amountBs: 5550, amountUsd: 5.95, currency: 'BS', methodId: 'pago_movil', methodLabel: 'Pago Móvil' }]
    },
    {
        id: 'apertura_1789057800000',
        tipo: 'APERTURA_CAJA',
        openingBs: 9980,
        openingUsd: 33,
        openingCop: 0,
        cajero: 'Luis Medina',
        cajeroId: 2,
        timestamp: '2026-09-10T16:11:00.000Z',
        createdAt: '2026-09-10T16:11:00.000Z',
        cajaCerrada: false
    }
];

export async function runReconciliation() {
    const env = loadEnv();
    const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_CLOUD_URL;
    const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;

    if (!url || !key) {
        throw new Error('Supabase URL o Key no encontrados en .env');
    }

    console.log('[Reconcile] Conectando a Supabase...');

    // 1. Obtener cierres históricos de Doc 18483
    const res18483 = await fetch(`${url}/rest/v1/sync_documents?id=eq.18483&select=data`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const data18483 = await res18483.json();
    const sales18483 = data18483[0]?.data?.payload || [];
    const cierres = sales18483.filter(s => s.tipo === 'REGISTRO_CIERRE');
    console.log(`[Reconcile] Cierres históricos recuperados: ${cierres.length}`);

    // 2. Obtener ventas cerradas previas al día de hoy de Doc 60
    const res60 = await fetch(`${url}/rest/v1/sync_documents?id=eq.60&select=data`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const data60 = await res60.json();
    const sales60 = data60[0]?.data?.payload || [];

    const historicalClosed = sales60.filter(s => {
        if (s.tipo === 'APERTURA_CAJA') return false;
        if (s.tipo === 'REGISTRO_CIERRE') return false;
        if (s.saleNumber >= 785) return false;
        if (s.id?.startsWith('sale_manual_100926_')) return false;
        if (s.id === 'gasto_teipe_1789067070525') return false;
        return true;
    }).map(s => ({ ...s, cajaCerrada: true }));

    const unifiedPayload = [
        ...CANONICAL_SHIFT_10092026,
        ...historicalClosed,
        ...cierres
    ];

    console.log(`[Reconcile] Payload unificado preparado con ${unifiedPayload.length} registros.`);

    const updateRes = await fetch(`${url}/rest/v1/sync_documents?id=eq.60`, {
        method: 'PATCH',
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        },
        body: JSON.stringify({
            data: { payload: unifiedPayload },
            updated_at: new Date().toISOString()
        })
    });

    if (!updateRes.ok) {
        const text = await updateRes.text();
        throw new Error(`Error al actualizar Doc 60: ${updateRes.status} ${text}`);
    }

    const updated = await updateRes.json();
    console.log(`[Reconcile] ¡Éxito! Doc 60 actualizado con ${updated[0]?.data?.payload?.length} registros.`);
}

if (process.argv[1]?.includes('reconcile-shift-10092026.mjs')) {
    runReconciliation().catch(console.error);
}
