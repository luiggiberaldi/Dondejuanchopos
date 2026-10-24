import fs from 'fs';
import path from 'path';

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

async function run() {
    const res = await fetch(`${url}/rest/v1/sync_documents?device_id=eq.${deviceId}&doc_id=eq.bodega_sales_v1&select=data`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const rows = await res.json();
    const sales = rows[0]?.data?.payload || [];

    const openApertura = sales.find(s => s && s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
    const fromTs = openApertura ? new Date(openApertura.timestamp).getTime() : 0;

    const shiftSales = sales.filter(s => {
        if (!s || s.cajaCerrada || s.tipo === 'APERTURA_CAJA') return false;
        const ts = new Date(s.timestamp || s.createdAt || 0).getTime();
        return ts >= fromTs;
    });

    shiftSales.sort((a, b) => new Date(a.timestamp || a.createdAt || 0).getTime() - new Date(b.timestamp || b.createdAt || 0).getTime());

    console.log('=== DETALLE DE CADA TRANSACCIÓN DEL TURNO ABIERTO ===');
    shiftSales.forEach(s => {
        const p = s.payments?.[0] || {};
        console.log({
            saleNumber: s.saleNumber,
            tipo: s.tipo,
            hora: new Date(s.timestamp).toLocaleTimeString(),
            cliente: s.customerName || 'Consumidor Final',
            totalBs: s.totalBs,
            totalUsd: s.totalUsd,
            metodo: p.methodLabel || p.methodId || s.paymentMethod,
            montoPagoBs: p.amountBs || s.totalBs,
            montoPagoUsd: p.amountUsd || s.totalUsd,
            items: (s.items || []).map(i => `${i.qty}x ${i.name}`)
        });
    });
}

run().catch(console.error);
