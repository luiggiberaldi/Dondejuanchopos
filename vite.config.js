// vite.config.js — Configuración de Vite + PWA + Vitest
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Versión del package.json para cacheId estable (INFRA-006).
import pkg from './package.json' with { type: 'json' };
const APP_VERSION = pkg.version || '1.0.0';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // INFRA-007: 'autoUpdate' causaba recargas abruptas; ahora avisa.
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'pwa-192x192.png', 'pwa-512x512.png', 'logo.png', 'logodark.png'],
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: false,   // INFRA-007: no forzar; dejar que el usuario acepte.
        clientsClaim: true,
        // INFRA-006: cacheId estable basado en versión del package.json (no Date.now()).
        cacheId: `preciosaldia-bodega-v${APP_VERSION}`,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Precios Al Día — Bodegas',
        short_name: 'PreciosAlDía Bodegas',
        description: 'Punto de venta bimoneda y gestor de inventario para bodegas de Venezuela',
        theme_color: '#10B981',
        background_color: '#10B981',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          { name: 'Vender Rápido', short_name: 'Vender', description: 'Abrir directamente el Punto de Venta', url: '/?view=ventas', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
          { name: 'Revisar Inventario', short_name: 'Inventario', description: 'Abrir catálogo de productos', url: '/?view=catalogo', icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }] },
        ],
      },
    }),
  ],

  // ── Dev server: proxy con CORS restringido (SEC-011 / INFRA-012) ──
  server: {
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        // Lista blanca de orígenes para el dev server.
        const allowedDevOrigins = ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173'];
        const origin = req.headers.origin;
        const corsOrigin = origin && allowedDevOrigins.includes(origin) ? origin : allowedDevOrigins[0];

        // ── /api/rates ──
        if (req.url.startsWith('/api/rates')) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', corsOrigin);
          res.setHeader('Vary', 'Origin');
          try {
            const googleScriptUrl = process.env.VITE_GOOGLE_SCRIPT_URL;
            if (!googleScriptUrl) {
              throw new Error('VITE_GOOGLE_SCRIPT_URL no configurada');
            }
            const response = await fetch(googleScriptUrl);
            const data = await response.json();
            if (data && data.bcv) {
              const rates = {
                bcv: { price: data.bcv.price, source: 'BCV Oficial (Local Dev)', change: data.bcv.change || 0 },
                euro: { price: data.euro?.price || data.bcv.price * 1.09, source: 'Euro BCV (Local Dev)', change: data.euro?.change || 0 },
                lastUpdate: new Date().toISOString(),
              };
              res.end(JSON.stringify(rates));
            } else {
              throw new Error('Invalid data format');
            }
          } catch (err) {
            // Fallback a ve.dolarapi.com
            try {
              const response = await fetch('https://ve.dolarapi.com/v1/dolares');
              const data = await response.json();
              const oficial = Array.isArray(data) ? data.find((d) => d.fuente === 'oficial' || d.nombre === 'Oficial') : null;
              const paralelo = Array.isArray(data) ? data.find((d) => d.fuente === 'paralelo' || d.nombre === 'Paralelo') : null;
              const bcvPrice = parseFloat(oficial?.promedio || 580);
              const euroPrice = parseFloat(paralelo?.promedio || bcvPrice * 1.09);
              res.end(JSON.stringify({
                bcv: { price: bcvPrice, source: 'BCV Oficial (Fallback)', change: 0 },
                euro: { price: euroPrice, source: 'Euro BCV (Fallback)', change: 0 },
                lastUpdate: new Date().toISOString(),
              }));
            } catch (fallbackErr) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to fetch rates: ' + err.message }));
            }
          }
          return;
        }

        // ── /api/analyze (SEC-011: CORS restringido + token efímero) ──
        if (req.url.startsWith('/api/analyze')) {
          if (req.method === 'POST') {
            // Validar origen.
            if (origin && !allowedDevOrigins.includes(origin)) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: 'Origin not allowed' }));
              return;
            }
            // Token efímero simple para dev (no es seguridad real, solo disuasivo).
            const expectedToken = process.env.DEV_ANALYZE_TOKEN;
            if (expectedToken && req.headers['x-dev-token'] !== expectedToken) {
              res.statusCode = 401;
              res.end(JSON.stringify({ error: 'Dev token required' }));
              return;
            }
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () => {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', corsOrigin);
              res.setHeader('Vary', 'Origin');
              try {
                const { prompt } = JSON.parse(body);
                if (typeof prompt !== 'string' || prompt.length > 4000) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'prompt inválido o demasiado largo (máx 4000 chars)' }));
                  return;
                }
                const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API_KEY_SECONDARY;
                if (!apiKey) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: 'Groq API Key not configured' }));
                  return;
                }
                const { default: Groq } = await import('groq-sdk');
                const groq = new Groq({ apiKey });
                const completion = await groq.chat.completions.create({
                  model: 'llama-3.3-70b-versatile',
                  messages: [{ role: 'user', content: prompt }],
                  max_tokens: 300,
                  temperature: 0.3,
                });
                res.end(JSON.stringify({ analysis: completion.choices[0]?.message?.content || null }));
              } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
            return;
          }
        }

        next();
      });
    },
  },

  // ── Test setup (Vitest) ──
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.{test,spec}.{js,jsx}'],
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      include: ['src/utils/**', 'src/core/**'],
      exclude: ['src/**/*.jsx', 'tests/**'],
    },
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          icons: ['lucide-react'],
          supabase: ['@supabase/supabase-js'],
          storage: ['localforage', 'zustand'],
          pdf: ['jspdf'],
          canvas: ['html2canvas'],
          // INFRA-008: separar groq-sdk y capacitor que antes se incluían en el chunk principal.
          groq: ['groq-sdk'],
        },
      },
    },
  },
}));
