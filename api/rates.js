// Vercel Serverless Function — Proxy de tasas BCV (dolarapi.com / Scraper BCV)
// Cachea en memoria por 14 minutos para no saturar la fuente externa.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

let cache = null;
let cacheTime = 0;
const CACHE_MS = 14 * 60 * 1000;

async function fetchBcvDirect() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
        const res = await fetch('https://www.bcv.org.ve', {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            }
        });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const html = await res.text();
        
        const usdMatch = html.match(/id="dolar"[\s\S]*?<strong class="strong-tb">[\s]*?([\d,.]+)/i);
        const eurMatch = html.match(/id="euro"[\s\S]*?<strong class="strong-tb">[\s]*?([\d,.]+)/i);
        
        if (usdMatch && eurMatch) {
            const usd = parseFloat(usdMatch[1].replace(',', '.').trim());
            const eur = parseFloat(eurMatch[1].replace(',', '.').trim());
            if (usd > 0 && eur > 0) {
                return { usd, eur };
            }
        }
    } catch (e) {
        clearTimeout(timeout);
        console.error('BCV Direct Scraping failed:', e.message);
    }
    return null;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // Return cache if fresh
    if (cache && Date.now() - cacheTime < CACHE_MS) {
        return res.status(200).setHeader('X-Cache', 'HIT').json(cache);
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        
        // 1. Intentar obtener tasas oficiales directamente de la página del BCV
        const directRates = await fetchBcvDirect();
        
        // 2. Fetch DolarApi en paralelo como respaldo y para la tasa paralela (USDT)
        const [resDollars, resEuros] = await Promise.all([
            fetch('https://ve.dolarapi.com/v1/dolares', { signal: controller.signal }).catch(() => null),
            fetch('https://ve.dolarapi.com/v1/euros', { signal: controller.signal }).catch(() => null)
        ]);
        clearTimeout(timeout);

        const dollarsData = resDollars && resDollars.ok ? await resDollars.json() : [];
        const eurosData = resEuros && resEuros.ok ? await resEuros.json() : [];

        const oficial  = Array.isArray(dollarsData) ? dollarsData.find(d => d.fuente === 'oficial'  || d.nombre === 'Oficial')  : null;
        const paralelo = Array.isArray(dollarsData) ? dollarsData.find(d => d.fuente === 'paralelo' || d.nombre === 'Paralelo') : null;
        const oficialEuro = Array.isArray(eurosData) ? eurosData.find(e => e.fuente === 'oficial' || e.nombre === 'Euro') : null;

        // Determinar tasa oficial de USD
        let bcvPrice = 0;
        let bcvSource = 'BCV Oficial';
        if (directRates && directRates.usd > 0) {
            bcvPrice = parseFloat(directRates.usd.toFixed(2));
            bcvSource = 'BCV Directo';
        } else if (oficial?.promedio) {
            bcvPrice = parseFloat(parseFloat(oficial.promedio).toFixed(2));
            bcvSource = 'BCV DolarApi';
        }

        if (bcvPrice <= 0) throw new Error('Sin tasa oficial disponible');

        // Determinar tasa oficial de Euro
        let euroPrice = 0;
        let euroSource = 'Euro BCV';
        if (directRates && directRates.eur > 0) {
            euroPrice = parseFloat(directRates.eur.toFixed(2));
            euroSource = 'Euro BCV Directo';
        } else if (oficialEuro?.promedio) {
            euroPrice = parseFloat(parseFloat(oficialEuro.promedio).toFixed(2));
            euroSource = 'Euro BCV DolarApi';
        } else {
            // Fallback triangulado
            euroPrice = parseFloat((bcvPrice * 1.14).toFixed(2));
            euroSource = 'Euro BCV (Triangulado)';
        }

        // Determinar tasa USDT (Paralelo)
        const usdtPrice = paralelo?.promedio 
            ? parseFloat(parseFloat(paralelo.promedio).toFixed(2)) 
            : parseFloat((bcvPrice * 1.12).toFixed(2));

        cache = {
            bcv:  { price: bcvPrice,  source: bcvSource, change: 0 },
            euro: { price: euroPrice, source: euroSource,    change: 0 },
            usdt: { price: usdtPrice, source: 'USDT Binance', change: 0 },
            lastUpdate: new Date().toISOString(),
        };
        cacheTime = Date.now();

        return res.status(200).setHeader('X-Cache', 'MISS').json(cache);

    } catch (err) {
        if (cache) {
            return res.status(200).setHeader('X-Cache', 'STALE').json({ ...cache, stale: true });
        }
        return res.status(503).json({ error: 'No se pudo obtener la tasa de cambio.' });
    }
}
