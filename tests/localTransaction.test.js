import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), write: vi.fn(), push: vi.fn(), oldRead: vi.fn() }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(), getItem: async key => structuredClone(m.db.get(key) ?? null),
    setItem: (k, v) => m.write(k, v), removeItem: async key => m.db.delete(key),
    clear: async () => m.db.clear(), createInstance: () => ({ getItem: m.oldRead }),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: m.push }));
let store, core;
const journal = 'bodega_storage_transaction_v1';
async function reload() { vi.resetModules(); store = (await import('../src/utils/storageService')).storageService; core = (await import('../src/utils/localStore')).localStore; }
beforeEach(async () => {
    vi.restoreAllMocks(); localStorage.clear(); m.db.clear(); m.push.mockReset();
    m.oldRead.mockReset().mockResolvedValue(null);
    m.write.mockReset().mockImplementation(async (k, v) => m.db.set(k, structuredClone(v)));
    await reload();
});
afterEach(() => vi.restoreAllMocks());
it('buffer no cambia IDB ni notifica antes de commit', async () => {
    const effect = vi.fn();
    await store.transaction(async tx => {
        await tx.setItem('fixture_a', { value: 1 }); await tx.setItem('fixture_b', { value: 2 });
        expect(m.db.size).toBe(0); expect(m.push).not.toHaveBeenCalled();
        tx.afterCommit(effect); expect(effect).not.toHaveBeenCalled();
        expect(await tx.getItem('fixture_a')).toEqual({ value: 1 });
        return { success: true };
    });
    expect(m.db.get('fixture_a')).toEqual({ value: 1 }); expect(m.db.get('fixture_b')).toEqual({ value: 2 });
    expect(effect).toHaveBeenCalledTimes(1); expect(m.push).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(journal)).toBeNull();
});
it.each(['throw','returned'])('fallo de preparación %s no tiene efectos', async mode => {
    const effect = vi.fn();
    const run = store.transaction(async tx => {
        await tx.setItem('fixture', { changed: true }); tx.afterCommit(effect);
        if (mode === 'throw') throw new Error('abort');
        return { success: false, error: 'invalid' };
    });
    if(mode === 'throw') await expect(run).rejects.toThrow('abort'); else expect((await run).success).toBe(false);
    expect(m.write).not.toHaveBeenCalled(); expect(effect).not.toHaveBeenCalled(); expect(m.push).not.toHaveBeenCalled();
    expect(localStorage.getItem(journal)).toBeNull();
});
it('sin espacio para journal rechaza y no aplica ni una clave', async () => {
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(k,v){ if(k===journal)throw new Error('quota');return set.call(this,k,v); });
    await expect(store.transaction(async tx => { await tx.setItem('fixture_a',1); await tx.setItem('fixture_b',2); return {success:true}; })).rejects.toMatchObject({code:'STORAGE_WRITE_FAILED'});
    // Se permite preparar el journal IDB; sin puntero no es un commit.
    expect(m.write.mock.calls.every(([key]) => key === journal)).toBe(true);
    expect(m.db.has('fixture_a')).toBe(false); expect(m.db.has('fixture_b')).toBe(false);
    expect(m.push).not.toHaveBeenCalled();
    await reload(); expect(await core.getItem('fixture_a')).toBeNull();
});
it('fallo intermedio de materialización conserva todo commit visible y recuperable tras reinicio', async () => {
    m.db.set('fixture_a',0);m.db.set('fixture_b',0);
    m.write.mockImplementation(async(k,v)=>{if(k==='fixture_b')throw new Error('quota');m.db.set(k,v);});
    expect(await store.transaction(async tx=>{await tx.setItem('fixture_a',1);await tx.setItem('fixture_b',2);return {success:true};})).toEqual({success:true});
    expect(m.db.get('fixture_a')).toBe(1);expect(m.db.get('fixture_b')).toBe(0);
    await reload();expect(await core.getItem('fixture_a')).toBe(1);expect(await core.getItem('fixture_b')).toBe(2);
    m.write.mockImplementation(async(k,v)=>m.db.set(k,v));await store.recoverTransactions();
    expect(m.db.get('fixture_b')).toBe(2);expect(localStorage.getItem(journal)).toBeNull();
});
it('no permite nuevo writer por encima de un commit que aún no puede recuperarse',async()=>{
    m.write.mockRejectedValue(new Error('IDB unavailable'));
    await store.transaction(async tx=>{await tx.setItem('fixture_a',1);return {success:true};});
    await expect(core.setItem('fixture_b',2)).rejects.toMatchObject({code:'STORAGE_RECOVERY_REQUIRED'});
    expect(await core.getItem('fixture_a')).toBe(1);expect(await core.getItem('fixture_b')).toBeNull();
});
it('journal corrupto impide lecturas y escritores sin borrar evidencia',async()=>{
    localStorage.setItem(journal,'{broken');m.db.set('fixture',1);
    await expect(core.getItem('fixture')).rejects.toMatchObject({code:'STORAGE_READ_FAILED'});
    await expect(core.setItem('fixture',2)).rejects.toMatchObject({code:'STORAGE_READ_FAILED'});
    expect(localStorage.getItem(journal)).toBe('{broken');expect(m.db.get('fixture')).toBe(1);
});
it('dos transacciones concurrentes calculan desde el snapshot vigente bajo lock',async()=>{
    m.db.set('counter',0);
    await Promise.all(Array.from({length:10},()=>core.transaction(async tx=>{const n=await tx.getItem('counter');await tx.setItem('counter',n+1);return {success:true};})));
    expect(await core.getItem('counter')).toBe(10);
});
it('guardias de negocio bloquean el lote completo',async()=>{
    m.db.set('bodega_customers_v1',Array.from({length:10},(_,id)=>({id})));
    await expect(store.transaction(async tx=>{await tx.setItem('fixture',1);await tx.setItem('bodega_customers_v1',[]);return {success:true};})).rejects.toThrow('[CircuitBreaker]');
    expect(m.db.has('fixture')).toBe(false);expect(m.db.get('bodega_customers_v1')).toHaveLength(10);
});
it('un clear invocado antes de una transacción no elimina su commit posterior',async()=>{
    await Promise.all([core.clear(),core.transaction(async tx=>{await tx.setItem('after_clear',1);return {success:true};})]);
    expect(await core.getItem('after_clear')).toBe(1);
});
it('capturar error de remove no permite confirmar el resto del buffer',async()=>{
    await expect(core.transaction(async tx=>{await tx.setItem('fixture',1);try{await tx.removeItem(journal);}catch{}return {success:true};})).rejects.toThrow('reservada');
    expect(m.db.has('fixture')).toBe(false);
});
it.each([new Map([['x',1]]),new Date('2026-01-01'),-0,[undefined],Array(2)])('rechaza pérdida de tipo transaccional %j',async value=>{
    await expect(core.transaction(async tx=>{await tx.setItem('fixture',value);return {success:true};})).rejects.toThrow();
    expect(m.write).not.toHaveBeenCalled();
});
it('journal grande utiliza IDB y un puntero pequeño, no una copia gigante en LS',async()=>{
    const set=Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(k,v){if(k===journal && v.length>200)throw new Error('LS limited');return set.call(this,k,v);});
    await core.transaction(async tx=>{await tx.setItem('fixture',{large:'x'.repeat(100000)});return {success:true};});
    expect(m.db.get('fixture').large.length).toBe(100000);
});
it('puntero IDB incorrecto no se confunde con ausencia',async()=>{
    localStorage.setItem(journal,JSON.stringify({version:1,id:'missing',storage:'idb'}));
    await expect(core.getItem('fixture')).rejects.toMatchObject({code:'STORAGE_READ_FAILED'});
});
it('lectura histórica retenida no oculta un commit durable posterior',async()=>{
    let entered,release;
    const started=new Promise(resolve=>{entered=resolve;});
    const held=new Promise(resolve=>{release=resolve;});
    m.oldRead.mockImplementationOnce(async()=>{entered();return held;});
    const reading=core.getItem('bodega_accounts_v2',[]);
    await started;
    // Simular otra instancia que confirma mientras la fuente antigua responde.
    localStorage.setItem(journal,JSON.stringify({version:1,id:'newer-commit',entries:[{key:'bodega_accounts_v2',kind:'value',value:[{id:'new'}]}]}));
    release([{id:'old'}]);
    expect(await reading).toEqual([{id:'new'}]);
    expect(m.write).not.toHaveBeenCalled();
});
it('un aborto no adelanta el timestamp de un snapshot auxiliar no guardado',async()=>{
    const customers=Array.from({length:6},(_,id)=>({id,favor:0,deuda:0}));
    m.db.set('bodega_customers_v1',customers);
    await expect(store.transaction(async tx=>{await tx.setItem('bodega_customers_v1',customers);throw new Error('abort');})).rejects.toThrow('abort');
    expect(localStorage.getItem('bodega_customers_shadow_backup_ts')).toBeNull();
    expect(m.db.has('bodega_customers_shadow_backup_v1')).toBe(false);
});
it('handles tx no se pueden usar después de terminar',async()=>{
    let leaked;await core.transaction(async tx=>{leaked=tx;return {success:true};});
    await expect(leaked.setItem('fixture',1)).rejects.toThrow('cerrada');expect(m.write).not.toHaveBeenCalled();
});
