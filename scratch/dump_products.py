import json

with open('123456.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

products = data.get('data', {}).get('idb', {}).get('bodega_products_v1', [])

with open('scratch/products_list.txt', 'w', encoding='utf-8') as f_out:
    for idx, p in enumerate(products):
        f_out.write(f"{idx+1}. ID: {p.get('id')} | Name: '{p.get('name')}' | USD: {p.get('priceUsd')} | BsMan: {p.get('priceBsManual')} | BoxUSD: {p.get('boxPriceUsd')} | BoxBs: {p.get('boxPriceBs')} | HalfUSD: {p.get('halfBoxPriceUsd')} | HalfBs: {p.get('halfBoxPriceBs')} | ForceBCV: {p.get('forceBcv')}\n")

print("Saved to scratch/products_list.txt")
