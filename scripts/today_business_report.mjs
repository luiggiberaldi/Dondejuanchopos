import fs from 'fs';
import path from 'path';

// Cargar variables de entorno de .env
const envPath = path.resolve(process.cwd(), '.env');
const env = {};
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const idx = t.indexOf('=');
        if (idx > -1) {
            let val = t.substring(idx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }
            env[t.substring(0, idx).trim()] = val;
        }
    });
}

const url = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_CLOUD_URL;
const key = env.SUPABASE_SERVICE_KEY || env.VITE_SUPABASE_ANON_KEY;
const deviceId = 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F';

async function fetchDoc(docId) {
    const res = await fetch(`${url}/rest/v1/sync_documents?device_id=eq.${deviceId}&doc_id=eq.${docId}&select=data,updated_at`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const rows = await res.json();
    return rows[0] || null;
}

async function run() {
    console.log(`[Reporte Hoy] Consultando datos para ${deviceId}...`);

    // 1. Verificar presencia de la caja principal
    const resPairing = await fetch(`${url}/rest/v1/device_pairings?primary_device_id=eq.${deviceId}&select=last_seen_at`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const pairingData = await resPairing.json();
    const lastSeen = pairingData[0]?.last_seen_at;

    // 2. Obtener ventas principales
    const salesDoc = await fetchDoc('bodega_sales_v1');
    const sales = salesDoc?.data?.payload || [];

    // 3. Obtener tasa activa
    const rateDoc = await fetchDoc('street_rate_bs');
    const rate = rateDoc?.data?.payload || 'N/A';

    console.log(`Última conexión de caja: ${lastSeen}`);
    console.log(`Tasa registrada: ${rate}`);
    console.log(`Total registros en bodega_sales_v1: ${sales.length}`);

    // Buscar aperturas abiertas (turno activo)
    const openAperturas = sales.filter(s => s && s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
    console.log(`Aperturas abiertas encontradas: ${openAperturas.length}`);
    openAperturas.forEach(a => {
        console.log(` - Apertura ID: ${a.id} | Hora: ${a.timestamp} | Bs: ${a.openingBs} | USD: ${a.openingUsd} | Cajero: ${a.cajero}`);
    });

    // Encontrar la apertura activa del turno
    let activeApertura = null;
    if (openAperturas.length === 1) {
        activeApertura = openAperturas[0];
    } else if (openAperturas.length > 1) {
        const withFloat = openAperturas.filter(a => (Number(a.openingBs) || 0) > 0 || (Number(a.openingUsd) || 0) > 0);
        activeApertura = withFloat.length > 0
            ? withFloat.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())[0]
            : openAperturas[openAperturas.length - 1];
    }

    // Buscar ventas y movimientos del turno abierto
    const shiftFromTs = activeApertura?.timestamp ? new Date(activeApertura.timestamp).getTime() : null;

    // También buscar movimientos con fecha de hoy (2026-10-21)
    const todayStr = '2026-10-21';
    const todayMovements = sales.filter(s => {
        if (!s) return false;
        const ts = s.timestamp || s.createdAt || '';
        return ts.startsWith(todayStr);
    });

    console.log(`\nMovimientos con fecha de hoy (${todayStr}): ${todayMovements.length}`);

    // Movimientos del turno activo
    const shiftMovements = sales.filter(s => {
        if (!s || s.cajaCerrada === true) return false;
        if (s.tipo === 'APERTURA_CAJA') return false;
        if (shiftFromTs) {
            const ts = new Date(s.timestamp || s.createdAt || 0).getTime();
            return ts >= shiftFromTs;
        }
        return true;
    });

    console.log(`Movimientos del turno activo: ${shiftMovements.length}`);

    // Si no hay apertura activa o turno activo, mostrar el último cierre y las últimas operaciones
    const cierres = sales.filter(s => s && s.tipo === 'REGISTRO_CIERRE');
    cierres.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
    const latestCierre = cierres[0];

    console.log(`\nÚltimo cierre registrado: Cierre #${latestCierre?.cierreNumber} en ${latestCierre?.timestamp}`);
    console.log(`Detalle último cierre:`, latestCierre?.summary?.reconData);

    // Detallar las ventas del turno activo o de hoy
    const movementsToReport = shiftMovements.length > 0 ? shiftMovements : todayMovements;
    console.log(`\n--- DETALLE DE MOVIMIENTOS A REPORTAR (${movementsToReport.length}) ---`);

    let totalVentasBs = 0;
    let totalVentasUsd = 0;
    let totalItems = 0;
    const paymentMethods = {};
    const clientes = new Set();
    const productsSold = {};

    movementsToReport.forEach(m => {
        if (m.tipo === 'VENTA' || m.tipo === 'VENTA_FIADA' || m.tipo === 'VENTA_CASHEA' || m.tipo === 'COBRO_DEUDA') {
            totalVentasBs += (m.totalBs || 0);
            totalVentasUsd += (m.totalUsd || 0);
            if (m.customerName) clientes.add(m.customerName);

            (m.items || []).forEach(item => {
                const qty = item.qty || 1;
                totalItems += qty;
                productsSold[item.name] = (productsSold[item.name] || 0) + qty;
            });

            (m.payments || []).forEach(p => {
                const mLabel = p.methodLabel || p.methodId || 'Desconocido';
                if (!paymentMethods[mLabel]) paymentMethods[mLabel] = { bs: 0, usd: 0, count: 0 };
                paymentMethods[mLabel].bs += (p.amountBs || 0);
                paymentMethods[mLabel].usd += (p.amountUsd || 0);
                paymentMethods[mLabel].count += 1;
            });

            if (!m.payments || m.payments.length === 0) {
                const mLabel = m.paymentMethod || 'Sin especificar';
                if (!paymentMethods[mLabel]) paymentMethods[mLabel] = { bs: 0, usd: 0, count: 0 };
                paymentMethods[mLabel].bs += (m.totalBs || 0);
                paymentMethods[mLabel].usd += (m.totalUsd || 0);
                paymentMethods[mLabel].count += 1;
            }
        }
    });

    console.log({
        activeApertura: activeApertura ? { id: activeApertura.id, ts: activeApertura.timestamp, bs: activeApertura.openingBs, usd: activeApertura.openingUsd, cajero: activeApertura.cajero } : null,
        totalVentasBs,
        totalVentasUsd,
        totalTransacciones: movementsToReport.length,
        totalItems,
        clientesAtendidos: Array.from(clientes),
        paymentMethods,
        topProductos: Object.entries(productsSold).sort((a, b) => b[1] - a[1]).slice(0, 10)
    });
}

run().catch(console.error);
