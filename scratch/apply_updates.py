import json

with open('123456.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

products = data.get('data', {}).get('idb', {}).get('bodega_products_v1', [])

# Map of rules by ID or exact match / fuzzy match
# We will create explicit updates by ID to be 100% accurate!

updates_by_id = {
    # 1. Combos
    'efd24c9a-4500-47dc-bf38-37367d1d9547': {'priceUsd': 7.0}, # Combo 10 X 7

    # 2. Snacks & Galletas
    'ba983074-8bd0-4f7b-8d3c-75412a0499f4': {'priceUsd': 1.20}, # CHEEKESITOS PEQUEÑO (Chisquesitos: 1.2 $)
    'prod_juancho_1783994743_60': {'priceUsd': 1.20}, # Chiquesesito Pequeño
    '38ad6e54-6574-48a7-b5dd-10d6f6188b3b': {'priceUsd': 1.30}, # CHEETOS PEQUEÑO (Chetos Pequeño: 1.30 $)
    'c4651b5f-5a18-4210-8243-123a1521d067': {'priceUsd': 1.50}, # Cheitos flaming hot (Chetos Picante: 1.5 $)
    'prod_juancho_1783994743_59': {'priceUsd': 3.50}, # Chetos Grande (Cheetos Grandes: 3.5 $)
    'prod_juancho_1783994743_56': {'priceUsd': 3.80}, # Doritos Grande (Doritos Grandes: 3.8 $)
    'prod_juancho_1783994743_58': {'priceUsd': 1.75}, # Doritos Pequeño (Doritos Pequeños: 1.75 $)
    'prod_juancho_1783994743_52': {'priceUsd': 3.50}, # Jack Chicharrón Grande (Jacks Chicharrón Grande: 3.5 $)
    'prod_juancho_1783994743_54': {'priceUsd': 0.90}, # Raqueti (Raquet Pequeño: 0.90 $)
    'prod_juancho_1783994743_50': {'priceUsd': 1.50}, # Natu Chips (Natchips Pequeño: 1.5 $)
    'prod_juancho_1783994743_49': {'priceUsd': 1.00}, # Tostón Tom (Torn Tostón: 1 $)
    'prod_juancho_1783994743_53': {'priceUsd': 1.00}, # Pepito Pequeño (Pepito: 1 $)
    '7935a25f-6365-467f-b0d7-88cf7a88bbae': {'priceUsd': 1.00}, # Oreo chocolate (Oreo: 1 $)
    'prod_juancho_1783994743_50': {'priceUsd': 1.50}, # Natu Chips

    # 3. Dulces & Chocolates
    'prod_juancho_1783994743_44': {'priceBsManual': 200}, # Bonbonbum (Chupeta bonbombu: 200 bs)
    'prod_juancho_1783994743_69': {'priceUsd': 1.00}, # Halls (Halls: 1 $)
    'prod_juancho_1783994743_50': {'priceUsd': 1.35}, # (Wait: 50 is Natu Chips, Savoy Pequeño is 45)
    'prod_juancho_1783994743_45': {'priceUsd': 1.35}, # Chocolate Savoy Pequeño (Savoy Pequeño: 1.35 $)
    'prod_juancho_1783994743_43': {'priceUsd': 1.80}, # Samba (Samba: 1.80 $)
    'prod_juancho_1783994743_38': {'priceUsd': 1.80}, # Cocosette (Cocosette: 1.80 $)

    # 4. Víveres
    'prod_juancho_1783994743_31': {'priceUsd': 0.60, 'priceBsManual': 500}, # Harina Pan (Harina pan: 500 bs / 0.60 $)
    'prod_juancho_1783994743_34': {'priceUsd': 2.60}, # Pasta Primor Larga (Pasta: 2.6 $)
    'prod_juancho_1783994743_32': {'priceUsd': 1.80}, # Arroz Primor (Arroz: 1.8 $)
    'prod_juancho_1783994743_36': {'priceUsd': 1.00}, # Granola (Granola: 1 $)
    'prod_juancho_1783994743_33': {'priceUsd': 2.00}, # Cafe Flor De Arauca (Café: 2 $)
    'prod_juancho_1783994743_30': {'priceUsd': 2.25}, # Salsa De Tomate Pampero Pequeña (Pampero: 2.25 $)

    # 5. Bebidas sin Alcohol
    '2be1afc7-ff9a-4789-a581-d178cd1a45b3': {'priceBsManual': 1200}, # Glup 2lt (Glup Grande: 1200 bs)
    'prod_juancho_1783994743_12': {'priceBsManual': 600}, # Glup 1 Litro (Glup Pequeño: 600 bs)
    'fe5e7e76-f0d9-4ce8-bf8a-470472ca3c75': {'priceUsd': 1.80}, # JUSTY (Justín: 1.8 $)
    'prod_juancho_1783994743_13': {'priceBsManual': 1430}, # Golden 2 Litros (Golden: 1430 bs)
    'prod_juancho_1783994743_16': {'priceUsd': 1.50}, # Coca-Cola Lata (Refresco Lata: 1.5 $)
    'prod_juancho_1783994743_14': {'priceUsd': 1.00}, # Soda Milnava Lata (Soda: 1 $)
    'prod_juancho_1783994743_11': {'priceUsd': 1.50}, # Malta Lata (Malta Lata: 1.5 $)
    'prod_juancho_1783994743_10': {'priceUsd': 2.40}, # Malta Grande (Malta Grande: 2.4 $)
    'prod_juancho_1783994743_9': {'priceUsd': 0.75, 'priceBsManual': 700}, # Malta Retornable (Malta pequeña retornable: 700 bs / 0.75 $)

    # 6. Cervezas & Licores
    'prod_juancho_1783994743_0': {'priceBsManual': 1000}, # Cerveza Zulia (cerveza Zulia: 1000 bs unidad)
    'prod_juancho_1783994743_2': {'priceBsManual': 800}, # Tercio Polar (Tercio: 800 bs)
    'prod_juancho_1783994743_6': {
        'priceBsManual': 650, # Cerveza polar Light (unidad): 650 bs unidad
        'sellByBox': True, 'boxPriceUsd': 23.0, 'boxPriceBs': 26.0, # Caja polar Light: (26 $ bs) (23 $ divisa)
        'sellByHalfBox': True, 'halfBoxPriceUsd': 12.0, 'halfBoxPriceBs': 34.0, # Medias cajas: (34 $ bs) (12 $ divisa)
    },
    'prod_juancho_1783994743_3': {
        'sellByBox': True, 'boxPriceUsd': 23.0, 'boxPriceBs': 26.0, # Caja polar Negrita: (26 $ bolívares) (23 $ divisa)
        'sellByHalfBox': True, 'halfBoxPriceUsd': 12.0, 'halfBoxPriceBs': 34.0, # Medias cajas: (34 $ bs) (12 $ divisa)
    },
    'prod_juancho_1783994743_17': { # Solera Lata
        'priceBsManual': 1200, # Cervezas Lata Grandes: 1200 bs
        'sellByBox': True, 'boxPriceUsd': 25.0, 'boxPriceBs': 26.0, # Caja Solera: (25 $ divisa) (26 $ bs)
        'sellByHalfBox': True, 'halfBoxPriceUsd': 12.0, 'halfBoxPriceBs': 34.0, # Medias cajas: (34 $ bs) (12 $ divisa)
    },
    'prod_juancho_1783994743_7': {'priceBsManual': 1200}, # Polar Pilsen Lata Grande (Cervezas Lata Grandes: 1200 bs)
    'prod_juancho_1783994743_5': {'priceBsManual': 1200}, # Polar Light Lata Grande (Cervezas Lata Grandes: 1200 bs)

    'prod_juancho_1783994743_8': {'priceBsManual': 900}, # Polar Pilsen Lata Pequeña (Cervezas Lata Pequeñas: 900 bs)
    'prod_juancho_1783994743_4': {'priceBsManual': 900}, # Polar Light Lata Pequeña (Cervezas Lata Pequeñas: 900 bs)
    'prod_juancho_1783994743_1': {'priceBsManual': 900}, # Zulia Lata (Cervezas Lata Pequeñas: 900 bs)

    'prod_juancho_1783994743_15': {'priceUsd': 2.00}, # Caroreña Lata Pequeña (Caroreña: 2 $)
    'prod_juancho_1783994743_21': {'priceUsd': 6.00}, # Country Club (licor) (Country: 6 $)
    'prod_juancho_1783994743_20': {'priceUsd': 3.00}, # Tucacas (licor) (Tucacas: 3 $)
    'prod_juancho_1783994743_22': {'priceUsd': 8.00}, # Jhon Master (licor) (Jhon Master: 8 $)
    'prod_juancho_1783994743_19': {'priceUsd': 6.50}, # Sangría La Diosa (Diosa: 6.5 $)

    # 7. Cigarrillos & Chimó
    'prod_juancho_1783994743_64': { # Viceroy
        'priceBsManual': 120, # Viceroy detallado: 120 bs
        'sellByBox': True, 'boxPriceUsd': 2.85, # Viceroy caja: 2.85 $
    },
    'prod_juancho_1783994743_62': { # Consul
        'priceBsManual': 120, # Consul detallado: 120 bs
        'sellByBox': True, 'boxPriceUsd': 2.70, # Consul caja: 2.70 $
    },
    'prod_juancho_1783994743_63': { # Pall Mall
        'priceBsManual': 140, # Palmall detallado: 140 bs
        'sellByBox': True, 'boxPriceUsd': 4.00, # Palmall caja: 4 $
    },
    'prod_juancho_1783994743_65': { # Belmont
        'priceBsManual': 140, # Belmont detallado: 140 bs
        'sellByBox': True, 'boxPriceUsd': 4.00, # Belmont caja: 4 $
        'sellByHalfBox': True, 'halfBoxPriceUsd': 2.00, # Belmont media caja: 2 $
    },
    'prod_juancho_1783994743_67': { # Lucky
        'priceBsManual': 170, # Lucky detallado: 170 bs
        'sellByBox': True, 'boxPriceUsd': 4.85, # Lucky caja: 4.85 $
    },
    'prod_juancho_1783994743_68': {'priceUsd': 1.00}, # Chimo Apureñito (Chimo: 1 $)
}

updated_count = 0
changes_summary = []

for p in products:
    pid = p.get('id')
    if pid in updates_by_id:
        update_fields = updates_by_id[pid]
        old_repr = f"USD:{p.get('priceUsd')}, BsMan:{p.get('priceBsManual')}, BoxUSD:{p.get('boxPriceUsd')}, BoxBs:{p.get('boxPriceBs')}, HalfUSD:{p.get('halfBoxPriceUsd')}, HalfBs:{p.get('halfBoxPriceBs')}"
        
        for k, v in update_fields.items():
            p[k] = v
            
        new_repr = f"USD:{p.get('priceUsd')}, BsMan:{p.get('priceBsManual')}, BoxUSD:{p.get('boxPriceUsd')}, BoxBs:{p.get('boxPriceBs')}, HalfUSD:{p.get('halfBoxPriceUsd')}, HalfBs:{p.get('halfBoxPriceBs')}"
        changes_summary.append(f"[OK] '{p.get('name')}' (ID: {pid})\n   ANTES: {old_repr}\n   AHORA: {new_repr}")
        updated_count += 1

print(f"Total productos actualizados: {updated_count}\n")
for change in changes_summary:
    print(change)

# Save updated JSON files
with open('123456_actualizado.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

with open('123456.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("\n¡Archivos '123456.json' y '123456_actualizado.json' guardados con éxito!")
