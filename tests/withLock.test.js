// tests/withLock.test.js — Tests para el wrapper navigator.locks con fallback.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withLock, isLocksSupported } from '../src/utils/withLock';

describe('isLocksSupported', () => {
  it('devuelve un booleano', () => {
    expect(typeof isLocksSupported()).toBe('boolean');
  });
});

describe('withLock — camino nativo (navigator.locks disponible)', () => {
  it('ejecuta el callback y devuelve su resultado', async () => {
    const result = await withLock('test_lock_1', async () => 42);
    expect(result).toBe(42);
  });

  it('propaga errores del callback', async () => {
    await expect(
      withLock('test_lock_2', async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
  });

  it('garantiza exclusión mutua entre llamadas concurrentes', async () => {
    const order = [];
    const slow = async (id) => {
      await withLock('mutex_test', async () => {
        order.push(`start_${id}`);
        await new Promise((r) => setTimeout(r, 30));
        order.push(`end_${id}`);
      });
    };
    await Promise.all([slow(1), slow(2), slow(3)]);
    // Deben estar start/end intercalados (no overlapping).
    expect(order).toEqual([
      'start_1', 'end_1',
      'start_2', 'end_2',
      'start_3', 'end_3',
    ]);
  });
});

describe('withLock — fallback (sin navigator.locks)', () => {
  let originalLocks;
  beforeEach(() => {
    originalLocks = navigator.locks;
    // Eliminar navigator.locks para forzar el fallback.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(navigator, 'locks', { value: originalLocks, configurable: true });
  });

  it('cae al mutex en memoria y sigue garantizando exclusión', async () => {
    expect(isLocksSupported()).toBe(false);
    const order = [];
    const slow = async (id) => {
      await withLock('fallback_same_name_test', async () => {
        order.push(`start_${id}`);
        await new Promise((r) => setTimeout(r, 20));
        order.push(`end_${id}`);
      });
    };
    await Promise.all([slow(1), slow(2)]);
    expect(order).toEqual(['start_1', 'end_1', 'start_2', 'end_2']);
  });
});

describe('withLock — H01: nunca repetir trabajo ya iniciado', () => {
  afterEach(() => vi.restoreAllMocks());

  it('conserva la excepción y ejecuta una sola vez el efecto parcial', async () => {
    const error = new Error('falló después de guardar');
    let writes = 0;
    const callback = vi.fn(async () => { writes += 1; throw error; });
    await expect(withLock('h01_partial_write', callback)).rejects.toBe(error);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(writes).toBe(1);
  });

  it('no repite un callback que lanza sincrónicamente', async () => {
    const error = new TypeError('dato inválido');
    const callback = vi.fn(() => { throw error; });
    await expect(withLock('h01_sync_error', callback)).rejects.toBe(error);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('no oculta un fallo nativo posterior al callback ni vuelve a ejecutarlo', async () => {
    const error = new Error('respuesta del lock incierta');
    vi.spyOn(navigator.locks, 'request').mockImplementation(async (_name, _opts, fn) => {
      await fn();
      throw error;
    });
    const callback = vi.fn(async () => 'guardado');
    await expect(withLock('h01_after_callback', callback)).rejects.toBe(error);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('propaga cancelación nativa sin iniciar trabajo por fallback', async () => {
    const error = new DOMException('Operación cancelada', 'AbortError');
    vi.spyOn(navigator.locks, 'request').mockRejectedValue(error);
    const callback = vi.fn(async () => 'no ejecutar');
    await expect(withLock('h01_aborted', callback)).rejects.toBe(error);
    expect(callback).not.toHaveBeenCalled();
  });

  it('permite que el siguiente trabajo termine tras una excepción sin duplicar el primero', async () => {
    const events = [];
    const results = await Promise.allSettled([
      withLock('h01_continue', async () => { events.push('primero'); throw new Error('fallo'); }),
      withLock('h01_continue', async () => { events.push('segundo'); return 'ok'; }),
    ]);
    expect(results.map(r => r.status)).toEqual(['rejected', 'fulfilled']);
    expect(events).toEqual(['primero', 'segundo']);
  });

  it('trata locks=null como no soportado sin lanzar en feature detection', async () => {
    const originalLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', { value: null, configurable: true });
    try {
      expect(isLocksSupported()).toBe(false);
      const callback = vi.fn(async () => 7);
      await expect(withLock('h01_null_locks', callback)).resolves.toBe(7);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, 'locks', { value: originalLocks, configurable: true });
    }
  });
});

describe('withLock — validación de argumentos', () => {
  it('lanza TypeError si name no es string', async () => {
    await expect(withLock(null, async () => 1)).rejects.toThrow(TypeError);
    await expect(withLock('', async () => 1)).rejects.toThrow(TypeError);
  });

  it('lanza TypeError si fn no es función', async () => {
    await expect(withLock('x', null)).rejects.toThrow(TypeError);
    await expect(withLock('x', 'notafn')).rejects.toThrow(TypeError);
  });
});

describe('withLock — recuperación ante fallo del mecanismo nativo', () => {
  it('cae al mutex si navigator.locks.request lanza', async () => {
    const originalRequest = navigator.locks.request;
    let callCount = 0;
    navigator.locks.request = (name, opts, fn) => {
      callCount++;
      if (callCount === 1) throw new Error('transient');
      return fn();
    };
    const result = await withLock('recovery_test', async () => 'ok');
    expect(result).toBe('ok');
    navigator.locks.request = originalRequest;
  });
});
