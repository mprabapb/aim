#!/usr/bin/env python3
"""Build data/consumables.csv (Canon ink, toner, print heads, paper) from Canon India (in.canon).

Run from the repo root:  python3 tools/sync_consumables.py   (then python3 tools/build.py)
The daily Canon sync workflow runs it too.

Canon India lists each printer's "Related Consumables" (name, page yield, type and MRP) on the
printer's product page. This opens the page of every model in data/products.csv, collects those
tables, and writes one row per consumable with the printers it fits. If Canon's site looks broken
or blocks us, the existing file is kept.
"""
import csv, html, os, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRODUCTS = os.path.join(ROOT, 'data', 'products.csv')
OUT = os.path.join(ROOT, 'data', 'consumables.csv')
UA = {'User-Agent': 'Mozilla/5.0 (AIM Enterprises catalogue sync; Canon partner)'}
FIELDS = ['Group', 'Consumable', 'Type', 'Page Yield', 'MRP (Rs, incl. GST)', 'Fits Printers', 'Canon India page']
NO_PRICE = 'Price on request'


def fetch(url):
    url = urllib.parse.quote(url, safe=':/%?=&#+')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return ''
        except Exception:  # timeouts, resets
            pass
        time.sleep(5 * (attempt + 1))
    return None


def text(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def read_consumables(page):
    """[(name, type, yield, mrp or None)] from a product page's Related Consumables tables.

    Each table sits under a heading such as "Toner Cartridges" or "Ink Bottles"; its columns
    (Product Name, Page Yield, Product Type, ISO Standard, Price) vary between printer families.
    """
    out = []
    for part in re.split(r'class="consumablesPanel__heading--title"', page)[1:]:
        heading = text(part[part.index('>') + 1:part.find('</h3>')])
        table = re.search(r'<table class="consumablesPanel__body--table">(.*?)</table>', part, re.S)
        if not table:
            continue
        cols = [text(h).lower() for h in re.findall(r'head-item">(.*?)</div>', table.group(1), re.S)]
        body = table.group(1).split('<tbody>', 1)[-1]
        for row in re.findall(r'<tr[\s>](.*?)</tr>', body, re.S):
            cells = dict(zip(cols, re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)))
            name = text(cells.get('product name', ''))
            if not name:
                continue
            pages = re.sub(r'\D', '', text(cells.get('page yield', '')))
            kind = text(cells.get('product type', '')) or heading.rstrip('s')
            m = re.search(r'Rs\.?\s*(\d[\d\s,\u00a0\u202f]*)', text(row))
            mrp = int(re.sub(r'\D', '', m.group(1))) if m else 0
            out.append((name, kind, pages, mrp or None))
    return out


def group_for(name, kind):
    n, k = name.lower(), kind.lower()
    if n.startswith('pfi-'):
        return 'Large Format Inks'
    if 'paper' in k or 'paper' in n or re.match(r'(gp|pp|mp|sg|lu|pt|kp|rp)-', n):
        return 'Photo Paper'
    if 'head' in k or re.match(r'(bh|ch|pf)-', n):
        return 'Print Heads'
    if 'maintenance' in k or re.match(r'mc-', n):
        return 'Maintenance Cartridges'
    if 'drum' in k or 'drum' in n:
        return 'Drums'
    if 'toner' in k or n.startswith(('cartridge', 'npg', 'crg')):
        return 'Toner Cartridges'
    if 'bottle' in k or re.match(r'gi-', n):
        return 'Ink Bottles'
    if 'ribbon' in k or 'kp-' in n or 'rp-' in n:
        return 'Photo Paper'
    return 'Ink Cartridges'


def main():
    printers = list(csv.DictReader(open(PRODUCTS, encoding='utf-8')))
    found, fits, failed = {}, {}, 0
    for p in printers:
        page = fetch(p['Canon India page'])
        if page is None:
            failed += 1
            continue
        for name, kind, pages, mrp in read_consumables(page):
            key = name.lower()
            old = found.get(key)
            if not old or (mrp and not old[3]):
                found[key] = (name, kind, pages, mrp, p['Canon India page'])
            fits.setdefault(key, []).append(p['Model'])
        time.sleep(1)
    print(f'{len(found)} consumables found on {len(printers) - failed} Canon India pages ({failed} failed).')
    if len(found) < 30 or failed > len(printers) // 3:
        sys.exit('Too few consumables found; Canon India may have changed. Kept the existing list.')

    rows = []
    for key, (name, kind, pages, mrp, url) in found.items():
        rows.append({'Group': group_for(name, kind), 'Consumable': name, 'Type': kind,
                     'Page Yield': pages, 'MRP (Rs, incl. GST)': mrp or NO_PRICE,
                     'Fits Printers': '; '.join(dict.fromkeys(fits[key])), 'Canon India page': url})
    rows.sort(key=lambda r: (r['Group'], r['Consumable'].lower()))
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    priced = sum(1 for r in rows if r['MRP (Rs, incl. GST)'] != NO_PRICE)
    print(f'Wrote {len(rows)} consumables ({priced} with MRP) to data/consumables.csv')


if __name__ == '__main__':
    main()
