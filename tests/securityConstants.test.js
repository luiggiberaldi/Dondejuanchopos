// tests/securityConstants.test.js — Tests de política de seguridad.

import { describe, it, expect } from 'vitest';
import { validatePin, PIN_POLICY, LOGIN_RATE_LIMIT, FINANCIAL_EPSILON } from '../src/utils/securityConstants';

describe('validatePin', () => {
  it('rechaza PIN vacío', () => {
    expect(validatePin('')).not.toBeNull();
    expect(validatePin(null)).not.toBeNull();
    expect(validatePin(undefined)).not.toBeNull();
  });

  it('rechaza PIN con menos de MIN_LENGTH dígitos', () => {
    expect(validatePin('123')).toMatch(/al menos 6/);
    expect(validatePin('12345')).toMatch(/al menos 6/);
  });

  it('acepta PIN válido de 6 dígitos (no en blacklist)', () => {
    expect(validatePin('246810')).toBeNull();
    expect(validatePin('864213')).toBeNull();
    expect(validatePin('192837')).toBeNull();
  });

  it('rechaza PINs en blacklist', () => {
    expect(validatePin('123456')).toMatch(/predecible|demasiado/);
    expect(validatePin('000000')).toMatch(/predecible|demasiado/);
    expect(validatePin('111111')).toMatch(/predecible|demasiado/);
  });

  it('rechaza secuencias de mismo dígito', () => {
    expect(validatePin('999999')).toMatch(/mismos|predecible/);
  });

  it('rechaza caracteres no numéricos cuando DIGITS_ONLY', () => {
    expect(validatePin('abc123')).toMatch(/dígito/);
    expect(validatePin('12a456')).toMatch(/dígito/);
  });

  it('acepta PIN largo válido', () => {
    expect(validatePin('13572468')).toBeNull();
  });

  it('rechaza PIN demasiado largo', () => {
    expect(validatePin('1'.repeat(33))).toMatch(/exceder/);
  });
});

describe('PIN_POLICY', () => {
  it('tiene configuración razonable', () => {
    expect(PIN_POLICY.MIN_LENGTH).toBeGreaterThanOrEqual(6);
    expect(PIN_POLICY.PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100000);
    expect(PIN_POLICY.SALT_BYTES).toBeGreaterThanOrEqual(16);
    expect(PIN_POLICY.BLACKLIST.length).toBeGreaterThan(0);
  });

  it('está congelado (no se puede mutar)', () => {
    expect(() => { PIN_POLICY.MIN_LENGTH = 4; }).toThrow();
  });
});

describe('LOGIN_RATE_LIMIT', () => {
  it('tiene backoff exponencial', () => {
    expect(LOGIN_RATE_LIMIT.BACKOFF_FACTOR).toBeGreaterThan(1);
    expect(LOGIN_RATE_LIMIT.MAX_LOCKOUT_MS).toBeGreaterThan(LOGIN_RATE_LIMIT.LOCKOUT_MS);
  });

  it('tiene ventana de reseteo', () => {
    expect(LOGIN_RATE_LIMIT.RESET_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe('FINANCIAL_EPSILON', () => {
  it('define tolerancias razonables para reconciliación', () => {
    expect(FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_USD).toBeGreaterThan(0);
    expect(FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS).toBeGreaterThan(0);
    expect(FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_COP).toBeGreaterThan(0);
  });

  it('define umbral de anomalía de vuelto', () => {
    expect(FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER).toBeGreaterThan(1);
    expect(FINANCIAL_EPSILON.CHANGE_ANOMALY_MIN_USD).toBeGreaterThan(0);
  });
});
