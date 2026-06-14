import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logEvent } from '../../services/auditService';

// Pure JS SHA-256 implementation to guarantee it works in non-secure contexts and is synchronous
function sha256(ascii) {
    function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }
    
    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var lengthProperty = 'length';
    var i, j; // Used as a loop counter.
    var result = '';

    var words = [];
    var asciiLength = ascii[lengthProperty];
    
    var hash = sha256.h = sha256.h || [];
    var k = sha256.k = sha256.k || [];
    var primeCounter = k[lengthProperty];

    var isPrime = {};
    for (var candidate = 2; primeCounter < 64; candidate++) {
        if (!isPrime[candidate]) {
            for (i = 0; i < 313; i += candidate) {
                isPrime[i] = 1;
            }
            hash[primeCounter] = (mathPow(candidate, .5)*maxWord)|0;
            k[primeCounter++] = (mathPow(candidate, 1/3)*maxWord)|0;
        }
    }
    
    ascii += '\x80';
    while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii[lengthProperty]; i++) {
        j = ascii.charCodeAt(i);
        if (j >> 8) return ''; // ASCII only
        words[i >> 2] |= j << ((3 - i % 4) * 8);
    }
    words[words[lengthProperty]] = ((asciiLength * 8) / maxWord) | 0;
    words[words[lengthProperty]] = (asciiLength * 8);
    
    var hashTemp = hash.slice(0);
    // process each chunk
    for (j = 0; j < words[lengthProperty]; ) {
        var w = words.slice(j, j += 16); // The 512-bit block, split into 32-bit words
        var oldHash = hashTemp.slice(0);
        
        for (i = 0; i < 64; i++) {
            var w16 = w[i - 16], w15 = w[i - 15], w7 = w[i - 7], w2 = w[i - 2];
            var a = hashTemp[0], e = hashTemp[4], g = hashTemp[6];
            var temp1 = hashTemp[7]
                + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) // S1
                + ((e & hashTemp[5]) ^ (~e & g)) // ch
                + k[i]
                + (w[i] = (i < 16) ? w[i] : (
                        w[i - 16]
                        + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) // s0
                        + w[i - 7]
                        + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10)) // s1
                    ) | 0
                );
            var temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) // S0
                + ((a & hashTemp[1]) ^ (a & hashTemp[2]) ^ (hashTemp[1] & hashTemp[2])); // maj
            
            hashTemp = [(temp1 + temp2) | 0].concat(hashTemp); // new a
            hashTemp[4] = (hashTemp[4] + temp1) | 0; // new e
        }
        
        for (i = 0; i < 8; i++) {
            hashTemp[i] = (hashTemp[i] + oldHash[i]) | 0;
        }
    }
    
    for (i = 0; i < 8; i++) {
        var val = hashTemp[i];
        if (val < 0) val += maxWord;
        result += val.toString(16).padStart(8, '0');
    }
    return result;
}

const DEFAULT_USERS = [
    { id: 1, nombre: 'Administrador', rol: 'ADMIN', pin: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92' }, // 123456
    { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: '9af15b336e6a9619928537df30b2e6a2376569fcf9d7e773eccede65606529a0' } // 0000
];

export const useAuthStore = create(
    persist(
        (set, get) => ({
            usuarioActivo: (() => {
                try {
                    const saved = localStorage.getItem('abasto-device-session');
                    return saved ? JSON.parse(saved) : null;
                } catch { return null; }
            })(),
            usuarios: DEFAULT_USERS,
            requireLogin: false, // Login opcional, por defecto desactivado
            failedAttempts: 0,
            lockUntil: null,

            // ACCIONES
            login: async (pinInput, userId) => {
                // Simular un pequeño retardo para feedback visual (UX)
                await new Promise(r => setTimeout(r, 400));

                // Brute force protection
                const now = Date.now();
                if (get().lockUntil && now < get().lockUntil) {
                    const secsLeft = Math.ceil((get().lockUntil - now) / 1000);
                    return { success: false, error: `Bloqueado. Intente en ${secsLeft}s` };
                }

                const { usuarios } = get();
                const hashedPin = sha256(pinInput || '');
                
                let userEncontrado;
                
                if (userId) {
                    userEncontrado = usuarios.find(u => u.id === userId && u.pin === hashedPin);
                } else {
                    userEncontrado = usuarios.find(u => u.pin === hashedPin);
                }

                if (userEncontrado) {
                    set({ usuarioActivo: userEncontrado, failedAttempts: 0, lockUntil: null });
                    localStorage.setItem('abasto-device-session', JSON.stringify(userEncontrado));
                    logEvent('AUTH', 'LOGIN', `${userEncontrado.nombre} inicio sesion`, userEncontrado);
                    return { success: true };
                }

                const attempts = get().failedAttempts + 1;
                const lockUntil = attempts >= 5 ? Date.now() + 30000 : null; // 30s lockout after 5 fails
                set({ failedAttempts: attempts, lockUntil });
                return { success: false };
            },

            logout: () => {
                const { usuarioActivo } = get();
                if (usuarioActivo) logEvent('AUTH', 'LOGOUT', `${usuarioActivo.nombre} cerro sesion`, usuarioActivo);
                set({ usuarioActivo: null });
                localStorage.removeItem('abasto-device-session');
            },

            cambiarPin: (userId, nuevoPin) => {
                const hashedPin = sha256(nuevoPin || '');
                set((state) => ({
                    usuarios: state.usuarios.map(u => 
                        u.id === userId ? { ...u, pin: hashedPin } : u
                    )
                }));
                
                // Si el usuario que cambió el PIN es el activo, actualizar su sesión local
                const { usuarioActivo } = get();
                if (usuarioActivo && usuarioActivo.id === userId) {
                    const nuevoActivo = { ...usuarioActivo, pin: hashedPin };
                    set({ usuarioActivo: nuevoActivo });
                    localStorage.setItem('abasto-device-session', JSON.stringify(nuevoActivo));
                }
                const target = get().usuarios.find(u => u.id === userId);
                logEvent('AUTH', 'PIN_CAMBIADO', `PIN cambiado para ${target?.nombre || 'usuario'}`, get().usuarioActivo);
            },

            agregarUsuario: (nombre, rol, pin) => {
                const hashedPin = sha256(pin || '');
                set((state) => {
                    const maxId = state.usuarios.reduce((max, u) => Math.max(max, u.id), 0);
                    return {
                        usuarios: [...state.usuarios, { id: maxId + 1, nombre, rol, pin: hashedPin }]
                    };
                });
                logEvent('USUARIO', 'USUARIO_CREADO', `Usuario "${nombre}" (${rol}) creado`, get().usuarioActivo);
            },

            eliminarUsuario: (userId) => {
                const { usuarios, usuarioActivo } = get();
                // No permitir eliminar al último ADMIN
                const admins = usuarios.filter(u => u.rol === 'ADMIN');
                const target = usuarios.find(u => u.id === userId);
                if (target?.rol === 'ADMIN' && admins.length <= 1) return false;
                // No permitir eliminarse a sí mismo
                if (usuarioActivo?.id === userId) return false;
                
                set({ usuarios: usuarios.filter(u => u.id !== userId) });
                logEvent('USUARIO', 'USUARIO_ELIMINADO', `Usuario "${target.nombre}" (${target.rol}) eliminado`, usuarioActivo);
                return true;
            },

            editarUsuario: (userId, datos) => {
                const nuevosDatos = { ...datos };
                if (datos.pin) nuevosDatos.pin = sha256(datos.pin);

                set((state) => ({
                    usuarios: state.usuarios.map(u => 
                        u.id === userId ? { ...u, ...nuevosDatos } : u
                    )
                }));
                const { usuarioActivo } = get();
                if (usuarioActivo && usuarioActivo.id === userId) {
                    const nuevoActivo = { ...usuarioActivo, ...nuevosDatos };
                    set({ usuarioActivo: nuevoActivo });
                    localStorage.setItem('abasto-device-session', JSON.stringify(nuevoActivo));
                }
            },

            setRequireLogin: (val) => {
                set({ requireLogin: val });
                logEvent('CONFIG', 'LOGIN_REQUERIDO_MODIFICADO', `Login requerido establecido a ${val ? 'SI' : 'NO'}`);
            },

        }),
        {
            name: 'abasto-auth-storage', // Nombre para localStorage
            partialize: (state) => ({
                usuarios: state.usuarios,
                requireLogin: state.requireLogin,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                const migrated = state.usuarios.map(u => {
                    let currentPin = u.pin;
                    if (u.id === 1 && currentPin === '1234') currentPin = '123456';
                    if (u.id === 2 && currentPin === '000000') currentPin = '0000';
                    
                    // Hashear si no es un hash SHA-256
                    if (currentPin && currentPin.length !== 64) {
                        return { ...u, pin: sha256(currentPin) };
                    }
                    return { ...u, pin: currentPin };
                });
                state.usuarios = migrated;
            },
            storage: {
                getItem: (name) => {
                    const str = localStorage.getItem(name);
                    if (!str) return null;
                    try { return JSON.parse(str); } catch (e) { return null; }
                },
                setItem: (name, value) => {
                    localStorage.setItem(name, JSON.stringify(value));
                    // Disparar a la nube para P2P (Lazy import para evitar ciclos)
                    import('../useCloudSync').then(({ pushCloudSync }) => {
                        pushCloudSync(name, value);
                    }).catch(err => console.warn('No se pudo inyectar Auth Cloud', err));
                },
                removeItem: (name) => localStorage.removeItem(name)
            }
        }
    )
);
