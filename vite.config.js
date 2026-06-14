import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Archivos estáticos que deben estar disponibles offline
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'logo.png', 'logodark.png'],
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        cacheId: 'preciosaldia-bodega-v' + Date.now(),
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      manifest: {
        name: 'Precios Al Día — Bodegas',
        short_name: 'PreciosAlDía Bodegas',
        description: 'Punto de venta bimoneda y gestor de inventario para bodegas de Venezuela',
        theme_color: '#10B981', // Emerald 500
        background_color: '#10B981', // Verde esmeralda de la marca
        display: 'standalone', // Modo app nativa (sin barra de navegador)
        orientation: 'portrait', // Bloquear rotación
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
        shortcuts: [
          {
            name: "Vender Rápido",
            short_name: "Vender",
            description: "Abrir directamente el Punto de Venta",
            url: "/?view=ventas",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "Revisar Inventario",
            short_name: "Inventario",
            description: "Abrir catálogo de productos",
            url: "/?view=catalogo",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          }
        ]
      }
    })
  ],
  server: {
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url.startsWith('/api/rates')) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          try {
            // Fetch directly from the configured Google Script URL
            const googleScriptUrl = process.env.VITE_GOOGLE_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbx0N47Hg6XebPBhgSLnfkaFyR4ez9_UWFTCS0mcb978i5r-iraxcM5svMJao2HMtrtiAA/exec?token=Lvbp1994';
            const response = await fetch(googleScriptUrl);
            const data = await response.json();
            
            if (data && data.bcv) {
              const rates = {
                bcv: { price: data.bcv.price, source: 'BCV Oficial (Local Dev)', change: data.bcv.change || 0 },
                euro: { price: data.euro?.price || data.bcv.price * 1.09, source: 'Euro BCV (Local Dev)', change: data.euro?.change || 0 },
                lastUpdate: new Date().toISOString()
              };
              res.end(JSON.stringify(rates));
            } else {
              throw new Error('Invalid data format');
            }
          } catch (err) {
            // Fallback to ve.dolarapi.com
            try {
              const response = await fetch('https://ve.dolarapi.com/v1/dolares');
              const data = await response.json();
              const oficial  = Array.isArray(data) ? data.find(d => d.fuente === 'oficial'  || d.nombre === 'Oficial')  : null;
              const paralelo = Array.isArray(data) ? data.find(d => d.fuente === 'paralelo' || d.nombre === 'Paralelo') : null;
              const bcvPrice  = parseFloat(oficial?.promedio || 580);
              const euroPrice = parseFloat(paralelo?.promedio || bcvPrice * 1.09);
              res.end(JSON.stringify({
                bcv: { price: bcvPrice, source: 'BCV Oficial (Fallback)', change: 0 },
                euro: { price: euroPrice, source: 'Euro BCV (Fallback)', change: 0 },
                lastUpdate: new Date().toISOString()
              }));
            } catch (fallbackErr) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to fetch rates: ' + err.message }));
            }
          }
          return;
        }

        if (req.url.startsWith('/api/analyze')) {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Access-Control-Allow-Origin', '*');
              try {
                const { prompt } = JSON.parse(body);
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
    }
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
        }
      }
    }
  },
})