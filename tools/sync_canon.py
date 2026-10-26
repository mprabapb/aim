#!/usr/bin/env python3
"""Keep data/products.csv in step with Canon India (in.canon).

Run from the repo root:  python3 tools/sync_canon.py   (then python3 tools/build.py)
The scheduled GitHub workflow .github/workflows/sync-canon.yml runs both every day.

What it does:
  * Reads Canon India's product listings and adds new printer, copier, scanner and plotter models,
    and the camera range (EOS cameras, PowerShot, lenses, accessories, camcorders, Cinema EOS).
  * Opens each model's Canon India page and updates its MRP (or "Price on request" if Canon shows none).
    For cameras sold as body or kits, the kit list and the lowest MRP come from Canon's listing.
  * Saves each model's specification table and key features to data/specs.json.
  * Downloads the product photo again when Canon changes it.
  * Removes a model only when its Canon India page is gone (404) and it is no longer listed.
Model names and descriptions you have edited are kept. If Canon's site looks broken or blocks us,
nothing is changed. A summary is written to stdout and data/canon_sync.json.
"""
import csv, html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import CATEGORIES, slugify  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, 'data', 'products.csv')
STATE_PATH = os.path.join(ROOT, 'data', 'canon_sync.json')
SPECS_PATH = os.path.join(ROOT, 'data', 'specs.json')
IMG_DIR = os.path.join(ROOT, 'assets', 'products')
BASE = 'https://in.canon'
UA = {'User-Agent': 'Mozilla/5.0 (AIM Enterprises catalogue sync; Canon partner)'}
PRICE_COL = 'MRP (Rs, incl. GST)'
DESC_COL = 'Description (from Canon India)'
URL_COL = 'Canon India page'
NO_PRICE = 'Price on request'

# Canon India listings to scan for new models: (site section, category, subCategory)
LISTINGS = [
    ('consumer', 'printing', 'inkjet-printers'),
    ('consumer', 'printing', 'maxify'),
    ('consumer', 'printing', 'laser-printers'),
    ('consumer', 'printing', 'mobile-printers'),
    ('consumer', 'scanning', 'flatbed-scanners'),
    ('consumer', 'scanning', 'cheque-scanners'),
    ('consumer', 'scanning', 'document-scanners'),
    ('business', 'printing', 'multi-functional-devices'),
    ('business', 'printing', 'large-format-printers'),
    ('business', 'scanning', 'document-scanners'),
    ('business', 'scanning', 'cheque-scanners'),
    ('business', 'scanning', 'flatbed-scanners'),
    ('consumer', 'photography', 'interchangeable-lens-cameras'),
    ('consumer', 'photography', 'digital-compact-cameras'),
    ('consumer', 'photography', 'ef-lenses'),
    ('consumer', 'photography', 'accessories'),
    ('consumer', 'videography-solutions', 'camcorders'),
    ('consumer', 'videography-solutions', 'cinema-eos-system'),
    ('consumer', 'videography-solutions', 'cinema-eos-lenses'),
    ('consumer', 'videography-solutions', 'accessories'),
    ('business', 'videography-solutions', 'camcorders'),
    ('business', 'videography-solutions', 'cinema-eos-system'),
    ('business', 'videography-solutions', 'cinema-eos-lenses'),
    ('business', 'videography-solutions', 'broadcas-lenses'),
    ('business', 'videography-solutions', 'accessories'),
]
CAMERA_LISTINGS = {'photography', 'videography-solutions'}
CAT_NAME = {c[0]: c[1] for c in CATEGORIES}


def category_for(name, sub, cat=''):
    """Our catalogue category for a Canon model name, or None for things we don't list (e.g. Zoemini)."""
    n = name.lower()
    if cat in CAMERA_LISTINGS:
        if n.startswith('cn'):  # cinema and broadcast lenses turn up under several listings
            return CAT_NAME['cinelens']
        if sub == 'interchangeable-lens-cameras':
            return CAT_NAME['mirrorless' if n.startswith('eos r') else 'dslr']
        return CAT_NAME.get({'digital-compact-cameras': 'compact', 'ef-lenses': 'lens', 'accessories': 'camacc',
                             'camcorders': 'camcorder', 'cinema-eos-system': 'cinema'}.get(sub, ''))
    for prefix, cat in (('imagerunner', 'office'), ('imageforce', 'office'), ('imageclass', 'laser'),
                        ('pixma', 'inkjet'), ('maxify', 'maxify'), ('imageprograf', 'lfp'),
                        ('canoscan', 'flatbed'), ('lide', 'flatbed'), ('selphy', 'selphy')):
        if n.startswith(prefix):
            return CAT_NAME[cat]
    if sub == 'cheque-scanners':
        return CAT_NAME['cheque']
    if sub == 'document-scanners' or n.startswith(('imageformula', 'scanfront')):
        return CAT_NAME['docscan']
    return None


def fetch(url):
    """Return (status, text). status is the HTTP code, or 0 for a network error."""
    url = urllib.parse.quote(url, safe=':/%?=&#+')
    for attempt in range(4):
        wait = 5 * (attempt + 1)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                return r.status, r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return e.code, ''
            err = e.code
            if e.code == 429:  # Canon asks us to slow down
                ra = e.headers.get('Retry-After', '')
                wait = min(int(ra), 120) if ra.isdigit() else 30 * (attempt + 1)
        except Exception:  # timeouts, resets
            err = 0
        time.sleep(wait)
    return err, ''


def fetch_bytes(url):
    url = urllib.parse.quote(url, safe=':/%?=&#+')
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def page_key(url):
    """'https://in.canon/en/consumer/pixma-e3370/black/product' -> 'pixma-e3370'."""
    parts = urllib.parse.urlparse(url).path.strip('/').split('/')
    if parts and parts[0] == 'india':
        parts = parts[1:]
    return parts[2] if len(parts) >= 3 else url


def clean_url(url):
    path = urllib.parse.urlparse(url).path
    if path.startswith('/india/'):
        path = path[len('/india'):]
    return BASE + path


def rs(text):
    """'Rs. 178 995.00/U' -> '178995', or None."""
    p = re.search(r'Rs\.?\s*(\d[\d\s,\u00a0\u202f]*)', text or '')
    n = p and re.sub(r'\D', '', p.group(1))
    return n if n and int(n) > 0 else None


def model_name(name, cat, sub):
    """Camera names come with the body/kit in brackets: 'EOS R8 (Body)' -> 'EOS R8'."""
    if cat in CAMERA_LISTINGS and sub == 'interchangeable-lens-cameras':
        name = re.sub(r'\s*\([^)]*\)$', '', name)
        name = re.sub(r'\s+Kit$', '', name)
    return name.strip()


def read_listings():
    """{key: (name, product url, subCategory, category, variants)} for every model in the listings we scan.
    variants is [[name, MRP or None], ...] as Canon lists the body/kit/colour options."""
    found = {}
    for section, cat, sub in LISTINGS:
        offset = 0
        for _ in range(40):
            status, text = fetch(f'{BASE}/en/{section}/products/search/json?category={cat}&subCategory={sub}&max=30&offset={offset}')
            if status != 200:
                if cat in CAMERA_LISTINGS:  # a camera listing hiccup shouldn't hold up the printer catalogue
                    print(f'Warning: listing {section}/{cat}/{sub} failed ({status}); skipped today.')
                    break
                raise RuntimeError(f'listing {section}/{sub} failed ({status})')
            data = json.loads(text)
            res = data.get('results') or []
            for r in res:
                url = clean_url(r['url'])
                variants = []
                for v in r.get('variants') or []:
                    label = v.get('variantName') or r['name']
                    if label == r['name'] and v.get('colour') and v.get('variantCategory') and v['variantCategory'] not in label:
                        label += f" ({v['variantCategory']})"  # colour options share the model name
                    variants.append([label, rs(v.get('formattedPrice')) if v.get('hasPrice') else None])
                found.setdefault(page_key(url), (model_name(r['name'], cat, sub), url, sub, cat, variants))
            offset += len(res)
            if not res or not data.get('hasMore'):
                break
            time.sleep(1)
        time.sleep(1)
    return found


def meta(page, prop):
    m = (re.search(rf'<meta[^>]+property="{prop}"[^>]+content="([^"]*)"', page)
         or re.search(rf'<meta[^>]+content="([^"]*)"[^>]+property="{prop}"', page))
    return html.unescape(m.group(1)).strip() if m else ''


def read_product(page):
    """Parse a Canon India product page. Returns None if it doesn't look like one."""
    if 'mastheadDetails' not in page:
        return None
    price = NO_PRICE
    m = re.search(r'class="mastheadDetails__price[^"]*"(.{0,800})', page, re.S)
    p = m and re.search(r'Rs\.?\s*(\d[\d\s,\u00a0\u202f]*)', m.group(1))
    if p and int(re.sub(r'\D', '', p.group(1))) > 0:
        price = re.sub(r'\D', '', p.group(1))
    img = meta(page, 'og:image')
    if img.startswith('/'):
        img = BASE + img
    return {'price': price, 'image': img, 'title': meta(page, 'og:title'), 'desc': meta(page, 'og:description'),
            'specs': read_specs(page), 'features': read_features(page)}


def text_of(fragment):
    fragment = re.sub(r'<br\s*/?>', '\n', fragment)
    fragment = html.unescape(re.sub(r'<[^>]+>', '', fragment))
    lines = [re.sub(r'\s+', ' ', l).strip() for l in fragment.split('\n')]
    return '\n'.join(l for l in lines if l)


def read_specs(page):
    """[[label, value], ...] from the first variant's specification table on a Canon product page."""
    i = page.find('class="table-specifications"')
    if i < 0:
        return []
    table = page[i:page.find('</table>', i)]
    specs = []
    for label, value in re.findall(r'<tr>\s*<td>(.*?)</td>\s*<td>(.*?)</td>\s*</tr>', table, re.S):
        label, value = text_of(label), text_of(value)
        if label and value and value not in ('-', '--', 'N/A'):
            specs.append([label, value])
    return specs[:80]


def read_features(page):
    return [text_of(h) for h in re.findall(r'class="sellingPointCard[^"]*">\s*<h4>(.*?)</h4>', page, re.S)][:8]


def short_desc(text):
    text = re.sub(r'\s+', ' ', text).strip()
    first = re.split(r'(?<=[.!?])\s', text)[0]
    return (first if len(first) <= 160 else first[:157].rsplit(' ', 1)[0] + '...').rstrip('.')


def save_image(slug, src):
    ext = os.path.splitext(urllib.parse.urlparse(src).path)[1].lower() or '.png'
    data = fetch_bytes(src)
    for f in os.listdir(IMG_DIR):
        if os.path.splitext(f)[0] == slug:
            os.remove(os.path.join(IMG_DIR, f))
    with open(os.path.join(IMG_DIR, slug + ext), 'wb') as f:
        f.write(data)


def main():
    os.makedirs(IMG_DIR, exist_ok=True)
    with open(CSV_PATH, encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        fields, rows = reader.fieldnames, list(reader)
    state = json.load(open(STATE_PATH, encoding='utf-8')) if os.path.exists(STATE_PATH) else {}
    images = state.get('images', {})
    featured = set(json.load(open(os.path.join(ROOT, 'data', 'site.json'), encoding='utf-8')).get('featured', []))
    group_of = {r['Category']: r['Group'] for r in rows}
    have_img = {os.path.splitext(f)[0] for f in os.listdir(IMG_DIR)}

    listed = read_listings()
    print(f'Canon India lists {len(listed)} models in the categories we carry.')
    if len(listed) < 40:
        sys.exit('Too few models listed; Canon India may have changed. Nothing changed.')

    # New models
    known = {page_key(r[URL_COL]) for r in rows}
    new_rows = []
    for key, (name, url, sub, section_cat, _) in listed.items():
        cat = category_for(name, sub, section_cat)
        if key in known or not cat:
            continue
        group = 'Cameras' if section_cat in CAMERA_LISTINGS else group_of.get(cat, '')
        new_rows.append({'Group': group, 'Category': cat, 'Model': name,
                         PRICE_COL: NO_PRICE, DESC_COL: '', URL_COL: url})
        known.add(key)
    old_specs = json.load(open(SPECS_PATH, encoding='utf-8')) if os.path.exists(SPECS_PATH) else {}
    specs = {}

    new_ids = {id(r) for r in new_rows}
    changes = {'added': [], 'price': [], 'photo': [], 'removed': [], 'kept': []}
    errors, gone, ok_new = [], [], set()
    for r in rows + new_rows:
        status, page = fetch(r[URL_COL])
        info = read_product(page) if status == 200 else None
        is_new = id(r) in new_ids
        if status in (404, 410):
            if not is_new:
                gone.append(r)
        elif info is None:
            errors.append(f"{r['Model']} ({status or 'network error'})")
        else:
            slug = slugify(r['Model'])
            variants = (listed.get(page_key(r[URL_COL]), (0, 0, 0, 0, []))[4]
                        or old_specs.get(slug, {}).get('variants', []))  # listing skipped today: last known kits
            kit_prices = [int(v[1]) for v in variants if v[1]]
            if r.get('Group') == 'Cameras' and kit_prices:  # body/kit/colour options: show the lowest MRP
                info['price'] = str(min(kit_prices))
            entry = {k: v for k, v in (('specs', info['specs']), ('features', info['features'])) if v}
            if len(variants) > 1 or (variants and variants[0][0] != r['Model']):
                entry['variants'] = variants
            if entry:
                specs[slug] = entry
            if is_new:
                r[PRICE_COL] = info['price']
                r[DESC_COL] = short_desc(info['desc'])
                ok_new.add(id(r))
                changes['added'].append(f"{r['Model']} ({'Rs ' + info['price'] if info['price'] != NO_PRICE else NO_PRICE})")
            elif info['price'] != r[PRICE_COL].strip():
                changes['price'].append(f"{r['Model']}: {r[PRICE_COL]} -> {info['price']}")
                r[PRICE_COL] = info['price']
            src = info['image']
            if src and slug in have_img and slug not in images:
                images[slug] = src  # first run: the photo we already have is Canon's current one
            elif src and images.get(slug) != src:
                try:
                    save_image(slug, src)
                    if slug in have_img and not is_new:
                        changes['photo'].append(r['Model'])
                    images[slug] = src
                except Exception as e:
                    errors.append(f"{r['Model']} photo ({e})")
        time.sleep(2)  # be gentle with Canon's server

    total = len(rows) + len(new_rows)
    if len(errors) > total * 0.3:
        print('\n'.join(errors))
        sys.exit(f'{len(errors)} of {total} Canon pages failed to load; Canon India may be down or blocking. Nothing changed.')
    priced_before = sum(r[PRICE_COL].strip().isdigit() for r in rows)
    lost = sum(1 for c in changes['price'] if c.endswith(NO_PRICE))
    if priced_before and lost > priced_before * 0.25:
        sys.exit(f'{lost} models suddenly lost their MRP; Canon India may have changed its pages. Nothing changed.')

    # A model goes only when its page is gone AND Canon no longer lists it
    removed = set()
    if len(gone) <= 15:
        for r in gone:
            if page_key(r[URL_COL]) in listed or r['Model'] in featured:
                changes['kept'].append(f"{r['Model']} (Canon page missing, kept)")
                continue
            removed.add(id(r))
            changes['removed'].append(r['Model'])
            slug = slugify(r['Model'])
            images.pop(slug, None)
            for f in os.listdir(IMG_DIR):
                if os.path.splitext(f)[0] == slug:
                    os.remove(os.path.join(IMG_DIR, f))
            stale = os.path.join(ROOT, 'products', slug + '.html')
            if os.path.exists(stale):
                os.remove(stale)
    else:
        changes['kept'] += [f"{r['Model']} (Canon page missing; too many at once, kept)" for r in gone]

    # Write the CSV: new models go after the last model of their category
    added = [r for r in new_rows if id(r) in ok_new]
    out = [r for r in rows if id(r) not in removed]
    for r in added:
        idx = max((i for i, o in enumerate(out) if o['Category'] == r['Category']), default=len(out) - 1)
        out.insert(idx + 1, r)
    with open(CSV_PATH, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator='\n')
        w.writeheader()
        w.writerows(out)

    # Specs: keep the last good copy for pages we could not read today; drop removed models
    keep = {slugify(r['Model']) for r in out}
    for slug, entry in old_specs.items():
        if slug in keep and slug not in specs:
            specs[slug] = entry
    with open(SPECS_PATH, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(specs.items())), f, indent=1, ensure_ascii=False)
        f.write('\n')

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    state.update({'last_checked': now, 'models': len(out), 'last_changes': changes, 'images': dict(sorted(images.items()))})
    with open(STATE_PATH, 'w', encoding='utf-8') as f:
        json.dump(state, f, indent=1, ensure_ascii=False)
        f.write('\n')

    lines = [f'Checked {total} models with Canon India on {now}.']
    for label, key in (('New models', 'added'), ('MRP changes', 'price'), ('New photos', 'photo'),
                       ('Removed (no longer on Canon India)', 'removed'), ('Needs a look', 'kept')):
        if changes[key]:
            lines.append(f'\n{label}:')
            lines += [f'  - {c}' for c in changes[key]]
    if errors:
        lines.append('\nCould not read this time (left unchanged):')
        lines += [f'  - {e}' for e in errors]
    report = '\n'.join(lines)
    print(report)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as f:
            f.write('```\n' + report + '\n```\n')
    n = len(changes['added']) + len(changes['price']) + len(changes['photo']) + len(changes['removed'])
    with open(os.path.join(ROOT, '.sync-message'), 'w', encoding='utf-8') as f:
        f.write(f'Sync products with Canon India ({n} change{"s" if n != 1 else ""})\n\n{report}\n')


if __name__ == '__main__':
    main()
