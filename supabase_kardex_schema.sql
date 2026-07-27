-- =============================================================================
-- ESQUEMA KARDEX DE INVENTARIO - DONDEJUANCHOPOS
-- Archivo: supabase_kardex_schema.sql
-- =============================================================================

-- 1. Tabla Principal: kardex_movimientos (Registro Inmutable)
CREATE TABLE IF NOT EXISTS public.kardex_movimientos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    sucursal_id TEXT DEFAULT 'principal',
    producto_id TEXT NOT NULL,
    sku TEXT,
    producto_nombre TEXT NOT NULL,
    tipo TEXT NOT NULL,          -- 'VENTA', 'COMPRA', 'AJUSTE', 'MERMA', 'DEVOLUCION', 'INICIAL', 'CONTEO', 'AUTOCONSUMO'
    subtipo TEXT,                -- 'SISTEMA', 'MANUAL', 'SUPERVISOR', 'ANULACION'
    cantidad NUMERIC NOT NULL,   -- Positivo (+) para Entradas, Negativo (-) para Salidas
    unidad TEXT DEFAULT 'unidad',
    stock_antes NUMERIC NOT NULL,
    stock_despues NUMERIC NOT NULL,
    costo_unitario NUMERIC DEFAULT 0,
    costo_total NUMERIC DEFAULT 0,
    moneda TEXT DEFAULT 'USD',
    referencia_id TEXT,          -- sale_id, adjustment_id, expense_id, command_id
    referencia_tipo TEXT,        -- 'VENTA', 'ANULACION', 'AJUSTE_SUPERVISOR', 'GASTO_INTERNO', 'INICIAL'
    referencia_numero TEXT,      -- Número visible de ticket o comprobante
    cierre_id TEXT,              -- ID del turno/cierre de caja asociado
    turno_id TEXT,
    usuario_id TEXT,
    usuario_nombre TEXT,
    supervisor_id TEXT,
    motivo TEXT,                 -- Obligatorio en ajustes manuales, mermas y autoconsumos
    observaciones TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- 2. Tabla de Snapshots: kardex_snapshots (Cierres y Arqueos)
CREATE TABLE IF NOT EXISTS public.kardex_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    cierre_id TEXT NOT NULL,
    fecha_corte TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    usuario_id TEXT,
    usuario_nombre TEXT,
    total_items INTEGER DEFAULT 0,
    total_valorizado_usd NUMERIC DEFAULT 0,
    resumen_productos JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{productoId, stockTeorico, costoUnitario, valorTotal}]
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabla de Alertas: kardex_alertas (Discrepancias e Incidencias)
CREATE TABLE IF NOT EXISTS public.kardex_alertas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    producto_id TEXT NOT NULL,
    producto_nombre TEXT NOT NULL,
    tipo_alerta TEXT NOT NULL,   -- 'STOCK_NEGATIVO', 'DISCREPANCIA_CONTEO', 'VENTA_SIN_STOCK', 'AJUSTE_ANOMALO'
    descripcion TEXT NOT NULL,
    nivel TEXT DEFAULT 'MEDIO',  -- 'BAJO', 'MEDIO', 'ALTO', 'CRITICO'
    resuelto BOOLEAN DEFAULT FALSE,
    resuelto_por TEXT,
    resuelto_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Índices para Consultas y Auditorías Rápidas ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kardex_producto_fecha ON public.kardex_movimientos(producto_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_device_fecha ON public.kardex_movimientos(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_tipo_fecha ON public.kardex_movimientos(tipo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kardex_ref ON public.kardex_movimientos(referencia_tipo, referencia_id);
CREATE INDEX IF NOT EXISTS idx_kardex_cierre ON public.kardex_movimientos(cierre_id);

-- ── Hardening RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.kardex_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kardex_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kardex_alertas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acceso Publico kardex_movimientos" ON public.kardex_movimientos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso Publico kardex_snapshots" ON public.kardex_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acceso Publico kardex_alertas" ON public.kardex_alertas FOR ALL USING (true) WITH CHECK (true);
