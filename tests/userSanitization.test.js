import { describe, it, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
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

  // S4: `bodega_users_catalog_v1` viaja a sync_documents y lo lee el rol anon.
  // Solo `publishUserCatalog` puede escribirlo, y siempre saneado.
  test('bodega_users_catalog_v1 tiene un unico escritor y siempre saneado', () => {
      const files = [
          'src/components/Settings/UsersManager.jsx',
          'src/hooks/store/useAuthStore.js',
          'src/hooks/useSupervisorCommands.js',
      ];
      for (const rel of files) {
          const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf-8');
          const writes = [...src.matchAll(
              /localStorage\.setItem\(\s*'bodega_users_catalog_v1'\s*,\s*([^)]*)\)/g
          )];
          for (const w of writes) {
              expect(w[1]).toContain('sanitizeUserCatalog');
          }
      }
  });

  test('sanitizeUserCatalog elimina pin y plainPin', async () => {
      const { sanitizeUserCatalog: sanitizeFn } = await import('../src/utils/userCatalog');
      const out = sanitizeFn([
          { id: 1, nombre: 'Admin', rol: 'ADMIN', pin: 'pbkdf2$x', plainPin: '123456' },
      ]);
      expect(out[0]).not.toHaveProperty('pin');
      expect(out[0]).not.toHaveProperty('plainPin');
      expect(out[0].nombre).toBe('Admin');
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
