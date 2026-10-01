import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ db: new Map(), write: vi.fn(), audit: vi.fn(), push: vi.fn() }));
vi.mock('localforage', () => ({ default: {
    config: vi.fn(), getItem: async k => structuredClone(m.db.get(k) ?? null),
    setItem: (k,v) => m.write(k,v), removeItem: async k => m.db.delete(k),
    createInstance: () => ({ getItem: async () => null }),
} }));
vi.mock('../src/hooks/useCloudSync', () => ({ queueCloudSync: m.push, pushCloudSync: m.push }));
vi.mock('../src/services/auditService', () => ({ logEvent: m.audit }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: { getState: () => ({ usuarioActivo: { id:'actor', nombre:'Fixture', rol:'ADMIN' } }) } }));
vi.mock('../src/utils/saleNumberAllocator', () => ({ allocateSaleNumber: async (_device,{localSales}) => ({saleNumber:Math.max(0,...localSales.map(s=>Number(s.saleNumber)||0))+1,provisional:true,note:'fixture'} ) }));
let core,store,checkout,customerTx,voidSale;
const P='bodega_products_v1',C='bodega_customers_v1',S='bodega_sales_v1',K='bodega_kardex_v1',J='bodega_storage_transaction_v1';
const product={id:'p',name:'Fixture',stock:10,priceUsd:5,costUsd:1,unit:'unidad'};
const customer={id:'c',name:'Fixture',deuda:10,favor:0};
async function loadModules(){vi.resetModules();core=(await import('../src/utils/localStore')).localStore;store=(await import('../src/utils/storageService')).storageService;checkout=(await import('../src/utils/checkoutProcessor')).processSaleTransaction;customerTx=(await import('../src/utils/customerTransactionProcessor')).processCustomerTransaction;voidSale=(await import('../src/utils/voidSaleProcessor')).processVoidSale;}
function saleInput(){return {cart:[{...product,qty:1}],cartTotalUsd:5,cartTotalBs:200,cartSubtotalUsd:5,payments:[{methodId:'efectivo_usd',amountUsd:10,currency:'USD'}],changeBreakdown:{changeUsdGiven:0,changeBsGiven:0,vueltoParaMonederoUsd:5},selectedCustomerId:'c',customers:[customer],products:[product],effectiveRate:40,bcvRate:40,tasaCop:0,copEnabled:false,discountData:null,checkoutOperationId:'checkout-fixture'};}
function abono(extra={}){return {transactionAmount:5,currencyMode:'USD',type:'ABONO',customer,paymentMethod:'efectivo_usd',bcvRate:40,tasaCop:0,copEnabled:false,operationId:'abono-fixture',...extra};}
beforeEach(async()=>{localStorage.clear();m.db.clear();m.audit.mockReset();m.push.mockReset();m.write.mockReset().mockImplementation(async(k,v)=>m.db.set(k,structuredClone(v)));m.db.set(P,[product]);m.db.set(C,[customer]);m.db.set(S,[]);m.db.set(K,[]);await loadModules();});
afterEach(()=>vi.restoreAllMocks());
it('venta con stock y abono de vuelto confirma todos efectos del mismo commit',async()=>{
 const result=await checkout(saleInput());expect(result.success).toBe(true);
 expect((await core.getItem(P))[0].stock).toBe(9);expect((await core.getItem(C))[0].deuda).toBe(5);expect(await core.getItem(S)).toHaveLength(1);expect(await core.getItem(K)).toHaveLength(1);expect(localStorage.getItem(J)).toBeNull();
 const duplicate=await checkout(saleInput());expect(duplicate.duplicate).toBe(true);expect((await core.getItem(P))[0].stock).toBe(9);expect((await core.getItem(C))[0].deuda).toBe(5);
});
it('fallo al escribir journal rechaza venta sin deducir stock, cliente ni fichas',async()=>{
 const set=Storage.prototype.setItem;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(k,v){if(k===J)throw new Error('quota');return set.call(this,k,v);});
 await expect(checkout(saleInput())).rejects.toMatchObject({code:'STORAGE_WRITE_FAILED'});
 expect(m.db.get(P)[0].stock).toBe(10);expect(m.db.get(C)[0].deuda).toBe(10);expect(m.db.get(S)).toEqual([]);expect(m.db.get(K)).toEqual([]);expect(m.audit).not.toHaveBeenCalled();expect(m.push).not.toHaveBeenCalled();
});
it.each([P,K,S,C,'bodega_inventory_operations_v1','bodega_sales_journal_v1'])('fallo materializando %s recupera venta/cliente/inventario una sola vez',async key=>{
 m.write.mockImplementation(async(k,v)=>{if(k===key)throw new Error('fixture unavailable');m.db.set(k,structuredClone(v));});
 const result=await checkout(saleInput());expect(result.success).toBe(true);expect(localStorage.getItem(J)).not.toBeNull();
 await loadModules();expect((await core.getItem(P))[0].stock).toBe(9);expect((await core.getItem(C))[0].deuda).toBe(5);expect(await core.getItem(S)).toHaveLength(1);expect(await core.getItem(K)).toHaveLength(1);
 m.write.mockImplementation(async(k,v)=>m.db.set(k,structuredClone(v)));await store.recoverTransactions();
 const replay=await checkout(saleInput());expect(replay.duplicate).toBe(true);expect((await core.getItem(P))[0].stock).toBe(9);expect((await core.getItem(C))[0].deuda).toBe(5);expect(await core.getItem(K)).toHaveLength(1);
});
it('abono recuperable no repite el descuento de deuda con operationId estable',async()=>{
 m.write.mockImplementation(async(k,v)=>{if(k===S)throw new Error('fixture unavailable');m.db.set(k,structuredClone(v));});
 await customerTx(abono());await loadModules();expect((await core.getItem(C))[0].deuda).toBe(5);expect(await core.getItem(S)).toHaveLength(1);
 m.write.mockImplementation(async(k,v)=>m.db.set(k,structuredClone(v)));await store.recoverTransactions();
 expect((await customerTx(abono())).duplicate).toBe(true);expect((await core.getItem(C))[0].deuda).toBe(5);
 expect((await customerTx(abono({transactionAmount:6}))).error).toContain('identificador');
});
it('anulación recuperable aplica devolución y saldo una sola vez',async()=>{
 const sold=await checkout(saleInput());m.write.mockImplementation(async(k,v)=>{if(k===S)throw new Error('fixture unavailable');m.db.set(k,structuredClone(v));});
 await voidSale(sold.sale,[],[]);await loadModules();expect((await core.getItem(P))[0].stock).toBe(10);expect((await core.getItem(C))[0].deuda).toBe(10);expect((await core.getItem(S))[0].status).toBe('ANULADA');
 m.write.mockImplementation(async(k,v)=>m.db.set(k,structuredClone(v)));await store.recoverTransactions();await expect(voidSale(sold.sale,[],[])).rejects.toThrow('ya fue anulada');expect((await core.getItem(P))[0].stock).toBe(10);expect(await core.getItem(K)).toHaveLength(2);
});
it('montos altos requieren true booleano y quedan vinculados al saldo confirmado',async()=>{
 for(const value of [false,'true',1]) expect((await customerTx(abono({transactionAmount:1500,isExplicitHighAmount:value}))).error).toBeTruthy();
 const result=await customerTx(abono({transactionAmount:1500,isExplicitHighAmount:true}));
 expect(result.updatedCustomer.favor).toBe(1490);expect(result.updatedCustomer.highAmountApproval).toMatchObject({favor:1490,deuda:0,amountUsd:1500,actorId:'actor',operationId:'abono-fixture'});
});
it('saldo acumulado alto no se confirma mediante autorización de una operación anterior',async()=>{
 m.db.set(C,[{...customer,deuda:0,favor:290,isExplicitHighAmount:true}]);
 expect((await customerTx(abono({transactionAmount:20,operationId:'another'}))).error).toContain('confirmación');expect(m.db.get(C)[0].favor).toBe(290);
});
it('revalida pago total con deuda fresca antes del commit',async()=>{
 m.db.set(C,[{...customer,deuda:1500}]);
 const result=await customerTx(abono({transactionAmount:10,isFullPayment:true}));expect(result.error).toContain('confirmación');expect(m.db.get(C)[0].deuda).toBe(1500);
});
