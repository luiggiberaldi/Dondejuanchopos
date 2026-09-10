# Memoria y Reglas de Desarrollo — Donde Juancho POS (Precios al Día)

Este archivo define las directivas operativas mandatorias, contexto del negocio, infraestructura y el dispositivo central para cualquier sesión de IA y pair programming.

---

## 📱 DISPOSITIVO CENTRAL Y AUDITORÍAS (REGLA MANDATORIA)
> [!IMPORTANT]
> **DISPOSITIVO CENTRAL Y AUTORITATIVO DE PRODUCCIÓN:**
> * **`device_id`:** `PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`
> * **Tipo / Modelo:** Terminal portátil táctil Sunmi V2 / PDA de Caja Principal con impresora térmica integrada.
> * **Operador habitual:** Chailin (Rol: `CAJERO`).
> 
> **DIRECTIVA ABSOLUTA PARA TODA INVESTIGACIÓN O AUDITORÍA:**
> Siempre que el usuario solicite investigar, auditar, contrastar, revisar o corregir datos de ventas, inventario, Kardex, cierres de caja, arqueos o clientes, **ES OBLIGATORIO Y POR DEFECTO HACERLO PARA ESTE DISPOSITIVO (`PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`)**, consultando sus documentos en Supabase (`sync_documents?device_id=eq.PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`) o sus comandos encolados (`supervisor_commands?primary_device_id=eq.PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F`), a menos que el usuario indique explícitamente otro ID de dispositivo.

---

## ⚙️ Principios Clave de Arquitectura e Infraestructura
1. **Offline-First:** IndexedDB/localforage (`storageService`) es la fuente de verdad local. Sincronización en la nube bidireccional vía Supabase (`sync_documents`).
2. **Cero Cálculos de Punto Flotante con Dinero:** Todos los cálculos monetarios deben usar estrictamente `dinero.js` (`round2`, `mulR`, `subR`, `sumR`, `divR`). Nunca usar `Math.round` o `toFixed` para finanzas.
3. **Cerrojos de Concurrencia:** Todo read-modify-write en ventas, clientes, caja o inventario debe ejecutarse bajo `withLock('pos_write_lock')`.
4. **Regla de Oro en Clientes:** El saldo neto de clientes se normaliza estrictamente como `saldoNeto = favor - deuda`. Un cliente nunca puede tener deuda y saldo a favor simultáneamente.
5. **Reversibilidad de Transacciones:** Todo movimiento en la ficha del cliente (abonos, créditos, ventas) es reversible mediante `processVoidSale` con previsualización del nuevo saldo en `VoidMovementModal`.
