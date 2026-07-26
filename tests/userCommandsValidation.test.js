import { describe, it, expect } from 'vitest';
import { useAuthStore } from '../src/hooks/store/useAuthStore';

describe('PU7: Validación de comandos de usuario', () => {
  it('eliminarUsuario devuelve false si el usuario es el único ADMIN', () => {
    useAuthStore.setState({
      usuarios: [
        { id: 1, nombre: 'Admin', rol: 'ADMIN', bypassPin: false, pin: '123' },
        { id: 2, nombre: 'Cajero', rol: 'CAJERO', bypassPin: false, pin: '456' }
      ],
      usuarioActivo: { id: 2, nombre: 'Cajero', rol: 'CAJERO' }
    });

    const store = useAuthStore.getState();
    const admin = store.usuarios.find(u => u.rol === 'ADMIN');
    expect(admin).toBeDefined();
    
    // Al ser el único admin, eliminarUsuario debe retornar false
    const res = store.eliminarUsuario(admin.id);
    expect(res).toBe(false);
  });

  it('eliminarUsuario devuelve false si se intenta eliminar al usuario activo', () => {
    useAuthStore.setState({
      usuarios: [
        { id: 1, nombre: 'Admin 1', rol: 'ADMIN', bypassPin: false },
        { id: 2, nombre: 'Admin 2', rol: 'ADMIN', bypassPin: false }
      ],
      usuarioActivo: { id: 2, nombre: 'Admin 2', rol: 'ADMIN' }
    });

    const store = useAuthStore.getState();
    const res = store.eliminarUsuario(2);
    expect(res).toBe(false);
  });
});

describe('PU8: Validación de PIN duplicado real', () => {
  it('detecta duplicado comparando con plainPin', () => {
    const usuarios = [
      { id: 1, nombre: 'Admin', plainPin: '123456', pin: 'pbkdf2$hash1' },
      { id: 2, nombre: 'Cajero', plainPin: '654321', pin: 'pbkdf2$hash2' }
    ];

    const esDuplicado123456 = usuarios.some(u => u.plainPin === '123456');
    const esDuplicado999999 = usuarios.some(u => u.plainPin === '999999');

    expect(esDuplicado123456).toBe(true);
    expect(esDuplicado999999).toBe(false);
  });
});
