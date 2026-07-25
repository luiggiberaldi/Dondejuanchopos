import json

with open('123456.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

products = data.get('data', {}).get('idb', {}).get('bodega_products_v1', [])
print(f"Total productos en 123456.json: {len(products)}\n")

for p in products:
    name = p.get('name')
    usd = p.get('priceUsd')
    bs_man = p.get('priceBsManual')
    bs = p.get('priceBs')
    box_usd = p.get('boxPriceUsd')
    box_bs = p.get('boxPriceBs')
    half_usd = p.get('halfBoxPriceUsd')
    half_bs = p.get('halfBoxPriceBs')
    force_bcv = p.get('forceBcv')
    print(f"- Name: '{name}' | USD: {usd} | BsMan: {bs_man} | BoxUSD: {box_usd} | BoxBs: {box_bs} | HalfUSD: {half_usd} | HalfBs: {half_bs} | ForceBCV: {force_bcv}")
