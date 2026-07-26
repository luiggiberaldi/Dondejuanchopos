import { describe, it, expect } from 'vitest';
import { sanitizeUserCatalog } from '../src/utils/userCatalog';
import { useAuthStore } from '../src/hooks/store/useAuthStore';

describe('PU4.1: Sanitización de catálogo de usuarios para la nube', () => {
  it('elimina propiedades pin y plainPin de la lista de usuarios', () => {
    const rawUsers = [
      { id: 1, nombre: 'Admin', rol: 'ADMIN', pin: 'pbkdf2$hash...', plainPin: '123456', bypassPin: false },
      { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: '', plainPin: '', bypassPin: true }
    ];

    const sanitized = sanitizeUserCatalog(rawUsers);

    expect(sanitized).toEqual([
      { id: 1, nombre: 'Admin', rol: 'ADMIN', bypassPin: false },
      { id: 2, nombre: 'Cajero', rol: 'CAJERO', bypassPin: true }
    ]);

    expect(sanitized[0].pin).toBeUndefined();
    expect(sanitized[0].plainPin).toBeUndefined();
  });
});

describe('PU3: Retorno de promesa done en useAuthStore', () => {
  it('cambiarPin devuelve { ok: true, done: Promise }', async () => {
    useAuthStore.setState({
      usuarios: [
        { id: 1, nombre: 'Admin', rol: 'ADMIN', pin: 'old', plainPin: '000000', bypassPin: false }
      ]
    });

    const res = useAuthStore.getState().cambiarPin(1, '654321');
    expect(res.ok).toBe(true);
    expect(res.done).toBeInstanceOf(Promise);

    await res.done;

    const updatedUser = useAuthStore.getState().usuarios.find(u => u.id === 1);
    expect(updatedUser.plainPin).toBe('654321');
    expect(updatedUser.pin).not.toBe('old');
  });
});
