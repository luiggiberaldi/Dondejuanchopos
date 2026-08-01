// Vocabulario canónico. productProcessor.js sólo reconoce estos cuatro:
// cualquier otro valor cae en la inferencia y puede perder el precio congelado.
export const PRICING_MODES = Object.freeze(['tasa_dia', 'bcv', 'dual_usd', 'bs_fijo']);
export const FROZEN_MODES = Object.freeze(['bs_fijo']);
