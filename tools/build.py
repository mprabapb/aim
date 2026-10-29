#!/usr/bin/env python3
"""Generate the AIM Enterprises static site from data/site.json and data/products.csv.

Run from the repo root:  python3 tools/build.py
Edit the CSV (prices, descriptions) or site.json (contact details), then run it again.
MRPs in data/price_list.csv (from Canon's dealer price lists) win over the CSVs the daily
Canon India sync writes, and its consumables not on Canon India's website are added.
"""
import csv, hashlib, html, json, os, re
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Version query for shared assets, so browsers and phones fetch new copies after each change
# Bump the salt to give every asset a new URL (browsers cache GitHub Pages redirects)
ASSET_V = hashlib.md5(b'gh-pages-3' + b''.join(open(os.path.join(ROOT, 'assets', n), 'rb').read()
                              for n in ('style.css', 'site.js', 'logo.svg', 'canon-logo.svg'))).hexdigest()[:8]
SITE = json.load(open(os.path.join(ROOT, 'data', 'site.json'), encoding='utf-8'))
E = html.escape

# Category order, slug and the fallback line used when Canon gives no description.
CATEGORIES = [
    ('office', 'Office Multifunction Copiers (imageRUNNER / imageFORCE)', 'Office Copiers', 'A3/A4 multifunction copier for print, copy and scan in busy offices and departments.'),
    ('laser', 'Laser Printers & MFPs (imageCLASS)', 'Laser Printers', 'Reliable imageCLASS laser printer for offices that need fast, sharp output.'),
    ('inkjet', 'Ink Tank & Inkjet (PIXMA)', 'Ink Tank Printers', 'PIXMA printer with low running cost for home, school and small office use.'),
    ('maxify', 'Business Inkjet (MAXIFY)', 'Business Inkjet', 'MAXIFY business inkjet built for high volume colour printing at low cost per page.'),
    ('lfp', 'Large Format Printers & Plotters (imagePROGRAF)', 'Large Format', 'Wide format printer for drawings, maps, posters and CAD output.'),
    ('docscan', 'Document Scanners (imageFORMULA)', 'Document Scanners', 'imageFORMULA scanner for fast, accurate digitisation of office records.'),
    ('flatbed', 'Flatbed Scanners (CanoScan LiDE)', 'Flatbed Scanners', 'Slim USB-powered flatbed scanner for documents and photos.'),
    ('cheque', 'Cheque Scanners', 'Cheque Scanners', 'CTS-ready cheque scanner for banks and finance offices.'),
    ('selphy', 'Photo Printers (SELPHY)', 'Photo Printers', 'Compact photo printer for instant, lab-quality prints.'),
    # Cameras and lenses: listed on products/cameras.html
    ('mirrorless', 'EOS R Mirrorless Cameras', 'Mirrorless Cameras', 'Canon EOS R system mirrorless camera with fast Dual Pixel autofocus.'),
    ('dslr', 'EOS DSLR Cameras', 'DSLR Cameras', 'Easy-to-use Canon EOS DSLR camera for stills and Full HD video.'),
    ('compact', 'Compact Cameras (PowerShot / IXUS)', 'Compact Cameras', 'Pocket-sized Canon camera for travel, vlogging and everyday photos.'),
    ('lens', 'RF Lenses', 'Lenses', 'Canon RF lens for EOS R system cameras.'),
    ('camacc', 'Camera Accessories', 'Camera Accessories', 'Genuine Canon accessory for EOS cameras.'),
    ('camcorder', 'Professional Camcorders', 'Camcorders', 'Canon professional camcorder for events, news and broadcast.'),
    ('cinema', 'Cinema EOS Cameras', 'Cinema EOS', 'Canon Cinema EOS camera for film, documentary and broadcast production.'),
    ('cinelens', 'Cinema & Broadcast Lenses', 'Cinema Lenses', 'Canon cinema and broadcast lens for professional video production.'),
]
CAT_BY_NAME = {c[1]: c for c in CATEGORIES}
CAMERA_CATS = {'mirrorless', 'dslr', 'compact', 'lens', 'camacc', 'camcorder', 'cinema', 'cinelens'}


def cat_href(cat):
    """Catalogue page and anchor for a category, relative to the site root."""
    return f"products/{'cameras' if cat in CAMERA_CATS else 'index'}.html#{cat}"


def slugify(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', s.lower())).strip('-')


def rupees(n):
    """Indian digit grouping: 168095 -> 1,68,095."""
    s = str(n)
    if len(s) <= 3:
        return s
    head, tail = s[:-3], s[-3:]
    head = re.sub(r'(\d)(?=(\d\d)+$)', r'\1,', head)
    return f'{head},{tail}'


def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def load_price_list():
    """{kind: {normalised name: row}} from data/price_list.csv (MRPs from Canon's price lists)."""
    out = {'product': {}, 'consumable': {}}
    path = os.path.join(ROOT, 'data', 'price_list.csv')
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            for r in csv.DictReader(f):
                if r['MRP (Rs, incl. GST)'].strip().isdigit():
                    out[r['Kind'].strip()][norm(r['Name'])] = r
    return out


PRICE_LIST = load_price_list()
# Specification tables, key features and body/kit options read from Canon India by tools/sync_canon.py
_SPECS_PATH = os.path.join(ROOT, 'data', 'specs.json')
SPECS = json.load(open(_SPECS_PATH, encoding='utf-8')) if os.path.exists(_SPECS_PATH) else {}


def load_products():
    rows = []
    with open(os.path.join(ROOT, 'data', 'products.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            cat = CAT_BY_NAME[r['Category']]
            price = r['MRP (Rs, incl. GST)'].strip()
            pl = PRICE_LIST['product'].get(norm(r['Model']))
            if pl:
                price = pl['MRP (Rs, incl. GST)'].strip()
            spec = SPECS.get(slugify(r['Model']), {})
            kit_prices = {v[1] for v in spec.get('variants', []) if v[1]}
            rows.append({
                'from': bool(pl and pl['From'].strip()) or (not pl and len(kit_prices) > 1),
                'specs': spec.get('specs', []),
                'features': spec.get('features', []),
                'variants': spec.get('variants', []),
                'note': pl['Note'].strip() if pl else '',
                'model': r['Model'],
                'slug': slugify(r['Model']),
                'cat': cat[0],
                'cat_label': cat[2],
                'mrp': int(price) if price.isdigit() else None,
                'desc': r['Description (from Canon India)'].strip() or cat[3],
                'canon_url': r['Canon India page'],
            })
    order = [c[0] for c in CATEGORIES]
    rows.sort(key=lambda p: (order.index(p['cat']), p['model'].lower()))
    return rows


# Consumable groups in display order: (slug, name in data/consumables.csv, chip label)
CONSUMABLE_GROUPS = [
    ('toner', 'Toner Cartridges', 'Toner'),
    ('drum', 'Drums', 'Drums'),
    ('bottle', 'Ink Bottles', 'Ink Bottles'),
    ('cartridge', 'Ink Cartridges', 'Ink Cartridges'),
    ('lfp', 'Large Format Inks', 'Plotter Inks'),
    ('head', 'Print Heads', 'Print Heads'),
    ('maint', 'Maintenance Cartridges', 'Maintenance'),
    ('paper', 'Photo Paper', 'Paper & Ribbons'),
    ('scanner', 'Scanner Parts', 'Scanner Rollers'),
]


def load_consumables():
    path = os.path.join(ROOT, 'data', 'consumables.csv')
    if not os.path.exists(path):
        return []
    slug_of = {g[1]: g[0] for g in CONSUMABLE_GROUPS}
    extra = dict(PRICE_LIST['consumable'])
    with open(path, encoding='utf-8') as f:
        canon = list(csv.DictReader(f))
    for r in canon:  # price-list MRP wins over Canon India's
        pl = extra.pop(norm(r['Consumable']), None)
        if pl:
            r['MRP (Rs, incl. GST)'] = pl['MRP (Rs, incl. GST)']
    added = [{'Consumable': v['Name'], 'Group': v['Group'], 'Type': v['Type'], 'Page Yield': '',
              'MRP (Rs, incl. GST)': v['MRP (Rs, incl. GST)'], 'Fits Printers': v['Fits Printers']} for v in extra.values()]
    rows = []
    for r in canon + added:
        price = str(r['MRP (Rs, incl. GST)']).strip()
        rows.append({
            'name': r['Consumable'],
            'group': slug_of.get(r['Group'], 'cartridge'),
            'type': r['Type'],
            'pages': r['Page Yield'],
            'mrp': int(price) if price.isdigit() else None,
            'fits': [m.strip() for m in r['Fits Printers'].split(';') if m.strip()],
        })
    return rows


def wa_link(text):
    from urllib.parse import quote
    return f"https://wa.me/{SITE['whatsapp']}?text={quote(text)}"


# Two-row header like Canon India: segments in the grey band, everyday links in the white row below
SEGMENTS = [('products/index.html', 'Printers & Scanners'), ('products/cameras.html', 'Cameras & Lenses'), ('consumables.html', 'Consumables'), ('service.html', 'Service & AMC'), ('government.html', 'Government (GeM)')]
NAV = [('products/index.html', 'Products'), ('products/cameras.html', 'Cameras'), ('consumables.html', 'Consumables'), ('contact.html', 'Where to Buy'), ('service.html', 'Service Network'),
       ('service.html#book', 'Book a Service'), ('government.html', 'GeM Orders'), ('about.html', 'About Us'), ('contact.html', 'Contact'), ('support.html', 'Support')]
SEGMENT_FOR = {'Cameras': 'Cameras & Lenses', 'Consumables': 'Consumables', 'Service & AMC': 'Service & AMC', 'Support': 'Service & AMC', 'Government Buyers': 'Government (GeM)'}


# Brand icon paths (Simple Icons, CC0) for the Canon India social links
SOCIAL_ICONS = json.load(open(os.path.join(ROOT, 'data', 'social-icons.json'), encoding='utf-8'))


# Instagram's own colour is a gradient; the others use a flat brand colour set in the CSS
def hours_html(cls='hours'):
    lines = '<br>'.join(E(l) for l in SITE['hours_lines'])
    return f'<p class="{cls}"><strong>Office hours:</strong><br>{lines}</p>'

IG_GRADIENT = ('<defs><radialGradient id="ig-grad" cx="0.3" cy="1.07" r="1.3">'
               '<stop offset="0" stop-color="#fdd835"/><stop offset="0.25" stop-color="#fd5949"/>'
               '<stop offset="0.6" stop-color="#d6249f"/><stop offset="1" stop-color="#285aeb"/></radialGradient></defs>')


def social_links():
    def icon(name):
        fill = 'url(#ig-grad)' if name == 'instagram' else 'currentColor'
        defs = IG_GRADIENT if name == 'instagram' else ''
        return (f'<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">{defs}'
                f'<path fill="{fill}" d="{SOCIAL_ICONS[name]}"/></svg>')
    return ''.join(f'<a class="soc-{l["icon"]}" href="{E(l["url"])}" target="_blank" rel="noopener" aria-label="Canon India on {E(l["name"])}">'
                   f'{icon(l["icon"])}<span>{E(l["name"])}</span></a>' for l in SITE['canon_social'])


def page(path, title, desc, body, active=''):
    depth = path.count('/')
    up = '../' * depth
    seg_on = SEGMENT_FOR.get(active, 'Printers & Scanners')
    segments = ''.join(f'<a href="{up}{href}"{" class=\"on\"" if label == seg_on else ""}>{E(label)}</a>' for href, label in SEGMENTS)
    # Support, Cameras and Consumables sit in the bars above on desktop, so their main-row copies only show in the phone menu
    nav = ''.join(f'<a href="{up}{href}"{" class=\"nav-mobile\"" if href in ("support.html", "consumables.html", "products/cameras.html") else ""}>{E(label)}</a>' for href, label in NAV)
    ld = {
        '@context': 'https://schema.org', '@type': 'LocalBusiness', 'name': SITE['name'], 'openingHours': SITE['opening_hours'],
        'description': SITE['tagline'], 'telephone': [SITE['phone_display']] + [l['display'] for l in SITE['landlines']] + [SITE['canon_virtual']['display']], 'email': SITE['email'],
        'url': SITE['url'],
        'address': {'@type': 'PostalAddress', 'streetAddress': SITE['street'], 'addressLocality': SITE['city'],
                    'addressRegion': 'Andaman and Nicobar Islands', 'postalCode': SITE['pin'], 'addressCountry': 'IN'},
    }
    canonical = SITE['url'].rstrip('/') + '/' + (path if path != 'index.html' else '')
    out = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(title)}</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{E(canonical)}">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{E(SITE['name'])}">
<meta property="og:url" content="{E(canonical)}">
<meta property="og:image" content="{E(SITE['share_image'])}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="AIM Enterprises, Canon Authorised Partner">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&family=Figtree:wght@400;500&display=swap">
<link rel="stylesheet" href="{up}assets/style.css?v={ASSET_V}">
<link rel="icon" href="{up}assets/favicon.svg?v={ASSET_V}" type="image/svg+xml">
<script type="application/ld+json">{json.dumps(ld)}</script>
</head>
<body data-wa="{SITE['whatsapp']}" data-email="{SITE['email']}">
<header class="site-header">
<div class="brandbar"><div class="wrap">
  <a class="brand" href="{up}index.html" aria-label="AIM Enterprises home"><span class="brand-name">AIM ENTERPRISES</span><span class="brand-tag">Canon Authorized Premium Partner</span></a>
  <nav class="segments" aria-label="Sections">{segments}</nav>
  <span class="bar-divider" aria-hidden="true"></span>
  <a class="search-link" href="{up}products/index.html#search" aria-label="Search products"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M15.6 15.6 21 21" stroke="currentColor" stroke-width="1.4"/></svg></a>
  <a class="bar-accent" href="tel:{SITE['phone_tel']}">Call Us</a>
  <span class="bar-divider" aria-hidden="true"></span>
  <a class="partner-mark" href="{SITE['canon_listing_url']}" target="_blank" rel="noopener" title="Verify on Canon India"><img src="{up}assets/canon-logo.svg?v={ASSET_V}" alt="Canon" width="96" height="20"><span>Authorised Partner</span></a>
  <button class="nav-toggle" aria-expanded="false" aria-controls="nav">Menu</button>
</div></div>
<div class="menubar"><div class="wrap">
  <nav id="nav" aria-label="Main">{nav}</nav>
  <div class="menu-right">
    <a href="{up}service.html">AMC</a><a href="{up}support.html">Support</a><a href="{SITE['register_url']}" target="_blank" rel="noopener">Register Product</a>
    <span class="bar-divider" aria-hidden="true"></span>
    <a class="quote-link" href="{up}contact.html#quote"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="9.5" cy="20" r="1.4" fill="currentColor"/><circle cx="17.5" cy="20" r="1.4" fill="currentColor"/></svg>Get a Quote</a>
  </div>
</div></div>
<div class="megamenu"><div class="wrap">{''.join(f'<a href="{up}{cat_href(c[0])}">{cat_picture(c[0], up)}<span>{c[2]}</span></a>' for c in CATEGORIES if CAT_PHOTO.get(c[0]) or c[0] not in CAMERA_CATS)}</div></div>
</header>
<main>
{body}
</main>
<footer class="site-footer"><div class="wrap footer-grid">
  <div>
    <img src="{up}assets/logo.svg?v={ASSET_V}" alt="AIM Enterprises" width="170" height="44">
    <p class="partner-badge">{E(SITE['badge'])}</p>
    <p><a class="verify-link" href="{SITE['canon_listing_url']}" target="_blank" rel="noopener">Verify on Canon India: Authorised Dealer Listing</a></p>
    <p>{E(SITE['tagline'])}</p>
    <p class="small">GSTIN {E(SITE['gstin'])} · GeM Seller ID {E(SITE['gem_id'])}</p>
  </div>
  <div>
    <h3>Products</h3>
    {''.join(f'<a href="{up}products/index.html#{c[0]}">{c[2]}</a>' for c in CATEGORIES[:6])}
    <a href="{up}products/cameras.html">Cameras &amp; Lenses</a>
  </div>
  <div>
    <h3>Company</h3>
    <a href="{up}consumables.html">Consumables Price List</a><a href="{up}service.html">Service &amp; AMC</a><a href="{up}government.html">Government Buyers</a><a href="{up}about.html">About Us</a><a href="{up}contact.html">Contact</a>
  </div>
  <div>
    <h3>Support</h3>
    <a href="{up}support.html">Support Home</a><a href="{SITE['canon_listing_url']}" target="_blank" rel="noopener">Canon Authorised Dealer Certification</a>{''.join(f'<a href="{E(l["url"])}" target="_blank" rel="noopener">{E(l["title"])}</a>' for l in SITE['support_links'])}
  </div>
  <div>
    <h3>Visit Us</h3>
    <address>{'<br>'.join(E(l) for l in SITE['address_lines'])}</address>
    {hours_html('hours small')}
    <a href="tel:{SITE['phone_tel']}">{E(SITE['phone_display'])}</a>
    {''.join(f'<a href="tel:{l["tel"]}">{E(l["display"])}</a>' for l in SITE['landlines'])}
    <a href="tel:{SITE['canon_virtual']['tel']}">{E(SITE['canon_virtual']['display'])} (Canon virtual no.)</a>
    <a href="mailto:{SITE['email']}">{E(SITE['email'])}</a>
  </div>
</div>
<div class="wrap social-row"><span>Follow Canon India</span>{social_links()}</div>
<div class="wrap legal">© {date.today().year} AIM Enterprises, Sri Vijaya Puram. Product photos © Canon India. Canon, imageRUNNER, imageFORCE, imageCLASS, PIXMA, MAXIFY, imagePROGRAF, imageFORMULA, EOS, PowerShot and IXUS are trademarks of Canon Inc. MRPs are as published by Canon India and may change without notice.</div>
</footer>
<a class="wa-float" href="{wa_link('Hello AIM Enterprises, I have an enquiry.')}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">{WA_ICON}</a>
<script src="{up}assets/site.js?v={ASSET_V}" defer></script>
</body>
</html>
'''
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'w', encoding='utf-8') as f:
        f.write(out)


WA_ICON = '<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm0 23.6c-2 0-3.9-.5-5.6-1.5l-.4-.2-3.9 1 1-3.8-.3-.4A10.6 10.6 0 1 1 16 26.6zm5.8-7.9c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7 0a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5.9-1.6.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.7 3.7 0 0 0-1.1 2.7 6.4 6.4 0 0 0 1.3 3.4 14.7 14.7 0 0 0 5.7 5c2.1.9 2.9 1 4 .8.6-.1 1.9-.8 2.2-1.5s.3-1.4.2-1.5-.2-.2-.5-.4z"/></svg>'

CAT_ICON = {
    'office': '<rect x="14" y="30" width="72" height="44" rx="4"/><rect x="22" y="18" width="56" height="14" rx="2"/><rect x="26" y="74" width="48" height="8"/><rect x="60" y="40" width="18" height="8" rx="2" class="hl"/>',
    'laser': '<rect x="16" y="34" width="68" height="36" rx="6"/><rect x="28" y="22" width="44" height="14" rx="2"/><rect x="26" y="66" width="48" height="12" rx="2" class="hl"/>',
    'inkjet': '<rect x="14" y="36" width="72" height="32" rx="8"/><rect x="26" y="24" width="48" height="14" rx="2"/><rect x="20" y="44" width="8" height="16" rx="2" class="hl"/><rect x="30" y="44" width="8" height="16" rx="2" class="hl"/>',
    'maxify': '<rect x="14" y="30" width="72" height="40" rx="6"/><rect x="26" y="18" width="48" height="14" rx="2"/><rect x="58" y="38" width="20" height="10" rx="2" class="hl"/>',
    'lfp': '<rect x="6" y="34" width="88" height="20" rx="4"/><rect x="18" y="54" width="6" height="26"/><rect x="76" y="54" width="6" height="26"/><rect x="20" y="24" width="60" height="10" class="hl"/>',
    'docscan': '<path d="M20 64 L80 64 L74 42 L26 42 Z"/><rect x="32" y="20" width="36" height="24" rx="2" class="hl"/><rect x="18" y="64" width="64" height="12" rx="3"/>',
    'flatbed': '<rect x="12" y="44" width="76" height="20" rx="4"/><rect x="12" y="38" width="76" height="8" rx="3" class="hl"/>',
    'cheque': '<rect x="14" y="40" width="72" height="26" rx="6"/><rect x="24" y="28" width="52" height="14" rx="1" class="hl"/>',
    'selphy': '<rect x="22" y="38" width="56" height="30" rx="8"/><rect x="34" y="24" width="32" height="16" rx="2" class="hl"/>',
    'mirrorless': '<rect x="14" y="34" width="60" height="38" rx="6"/><rect x="30" y="26" width="22" height="10" rx="2"/><circle cx="56" cy="53" r="16" class="hl"/>',
    'dslr': '<rect x="14" y="34" width="60" height="40" rx="6"/><path d="M30 34 L36 22 L52 22 L58 34 Z"/><circle cx="56" cy="54" r="16" class="hl"/>',
    'compact': '<rect x="18" y="36" width="64" height="36" rx="6"/><circle cx="50" cy="54" r="12" class="hl"/>',
    'lens': '<rect x="24" y="30" width="52" height="40" rx="6"/><rect x="20" y="40" width="60" height="8" class="hl"/>',
    'camacc': '<rect x="30" y="20" width="40" height="60" rx="6"/><rect x="38" y="28" width="24" height="10" rx="2" class="hl"/>',
    'camcorder': '<rect x="12" y="38" width="58" height="30" rx="6"/><path d="M70 46 L88 38 L88 68 L70 60 Z" class="hl"/>',
    'cinema': '<rect x="20" y="34" width="50" height="40" rx="4"/><rect x="70" y="44" width="16" height="20" rx="3" class="hl"/><rect x="26" y="24" width="30" height="10" rx="2"/>',
    'cinelens': '<rect x="14" y="36" width="72" height="28" rx="6"/><rect x="30" y="32" width="8" height="36" class="hl"/><rect x="56" y="32" width="8" height="36" class="hl"/>',
}


def icon(cat):
    return f'<svg class="pic" viewBox="0 0 100 100" aria-hidden="true">{CAT_ICON[cat]}</svg>'


PHOTO_DIR = os.path.join(ROOT, 'assets', 'products')
PHOTOS = {os.path.splitext(f)[0]: f for f in os.listdir(PHOTO_DIR)} if os.path.isdir(PHOTO_DIR) else {}


def picture(p, up, lazy=True):
    """Canon's product photo when we have it, else the category drawing."""
    f = PHOTOS.get(p['slug'])
    if not f:
        return icon(p['cat'])
    return f'<img class="photo" src="{up}assets/products/{f}?v={ASSET_V}" alt="Canon {E(p["model"])}"{" loading=\"lazy\"" if lazy else ""}>'


CAT_PHOTO = {}  # category -> product whose photo stands for the category


def cat_picture(cat, up):
    p = CAT_PHOTO.get(cat)
    return picture(p, up) if p else icon(cat)


def price_html(p, note=False):
    if p['mrp']:
        extra = f'<span class="price-note">{E(p["note"])}</span>' if note and p.get('note') else ''
        return f'<p class="price">MRP {"from " if p.get("from") else ""}Rs. {rupees(p["mrp"])}.00/U<span class="price-note">inclusive of all taxes</span>{extra}</p>'
    return '<p class="price price-ask">Price on request</p>'


def card(p, up):
    return f'''<article class="card" data-cat="{p['cat']}" data-name="{E(p['model'].lower())}">
  <a href="{up}products/{p['slug']}.html" class="card-pic">{picture(p, up)}</a>
  <h3><a href="{up}products/{p['slug']}.html">{E(p['model'])}</a></h3>
  {price_html(p)}
  <div class="card-actions">
    <a class="btn btn-block" href="{up}contact.html?model={E(p['model'])}#quote">Enquire Now</a>
    <a class="text-link" href="{wa_link(f"Hello AIM Enterprises, please share your best price for Canon {p['model']}.")}" target="_blank" rel="noopener">Ask on WhatsApp ›</a>
  </div>
</article>'''


def ccard(c, up):
    fits = ', '.join(c['fits'][:3]) + (f" and {len(c['fits']) - 3} more" if len(c['fits']) > 3 else '')
    yld = f'<p class="cyield">Yield {rupees(int(c["pages"]))} pages</p>' if c['pages'].isdigit() else ''
    return f'''<article class="card ccard" data-cat="{c['group']}" data-name="{E((c['name'] + ' ' + ' '.join(c['fits'])).lower())}">
  <p class="card-cat">{E(c['type'] or 'Consumable')}</p>
  <h3>Canon {E(c['name'])}</h3>
  {yld}
  <p class="cfits">For {E(fits)}</p>
  {price_html(c)}
  <div class="card-actions">
    <a class="btn btn-block" href="{up}contact.html?model={E(c['name'])}#quote">Enquire Now</a>
    <a class="text-link" href="{wa_link(f"Hello AIM Enterprises, please share your best price and availability for Canon {c['name']}.")}" target="_blank" rel="noopener">Ask on WhatsApp ›</a>
  </div>
</article>'''


def variants_table(p):
    """Body, kit and colour options with their Canon India MRPs (only when there is a choice to show)."""
    vs = p['variants']
    if not vs or (len(vs) == 1 and not vs[0][1]):
        return ''
    head = 'Body &amp; Kit Options' if p['cat'] in ('mirrorless', 'dslr') else 'Available Options'
    rows = ''.join(f'''<tr><th scope="row">Canon {E(n)}</th><td class="num">{'Rs. ' + rupees(int(m)) + '.00' if m else 'On request'}</td>'''
                   f'''<td><a href="{wa_link(f"Hello AIM Enterprises, please share your best price for Canon {n}.")}" target="_blank" rel="noopener">Ask Price</a></td></tr>''' for n, m in vs)
    return (f'<section class="section reveal" id="options"><h2>{head}</h2><p>Canon India MRPs, inclusive of all taxes.</p>'
            f'<div class="ctable-wrap"><table class="ctable"><thead><tr><th>Model</th><th class="num">MRP (incl. GST)</th><th></th></tr></thead>'
            f'<tbody>{rows}</tbody></table></div></section>')


def specs_table(p):
    if not p['specs']:
        return ''
    rows = ''.join(f'<tr><th scope="row">{E(k)}</th><td>{"<br>".join(E(l) for l in v.split(chr(10)))}</td></tr>' for k, v in p['specs'])
    return (f'<section class="section reveal" id="specs"><h2>Specifications</h2>'
            f'<div class="ctable-wrap"><table class="ctable spec-table"><tbody>{rows}</tbody></table></div>'
            f'<p class="small">Specifications as published by Canon India. <a href="{E(p["canon_url"])}" target="_blank" rel="noopener">See the Canon India product page</a> for brochures and full details.</p></section>')


def consumables_table(items, up):
    rows = ''.join(f'''<tr><th scope="row">{E(c['name'])}</th><td class="num">{'Rs. ' + rupees(c['mrp']) + '.00' if c['mrp'] else 'On request'}</td>'''
                   f'''<td>{rupees(int(c['pages'])) + ' pages' if c['pages'].isdigit() else '-'}</td><td>{E(c['type'])}</td>'''
                   f'''<td><a href="{wa_link(f"Hello AIM Enterprises, please share your best price for Canon {c['name']}.")}" target="_blank" rel="noopener">Ask Price</a></td></tr>''' for c in items)
    return f'''<div class="ctable-wrap"><table class="ctable"><thead><tr><th>Consumable</th><th class="num">MRP (incl. GST)</th><th>Page Yield</th><th>Type</th><th></th></tr></thead><tbody>{rows}</tbody></table></div>'''


def build():
    products = load_products()
    consumables = load_consumables()
    fits_map = {}
    for c in consumables:
        for m in c['fits']:
            fits_map.setdefault(m, []).append(c)
    by_cat = {c[0]: [p for p in products if p['cat'] == c[0]] for c in CATEGORIES}
    for c in CATEGORIES:
        CAT_PHOTO[c[0]] = next((p for p in by_cat[c[0]] if p['slug'] in PHOTOS), None)

    # ---------- Home ----------
    featured_models = SITE['featured']
    featured = [p for m in featured_models for p in products if p['model'] == m]
    by_model = {p['model']: p for p in products}

    def shots(*models):
        return ''.join(f'<div class="bshot">{picture(by_model[m], "", lazy=False)}</div>' for m in models if m in by_model)

    def btns(buttons):
        return ''.join(f'<a class="btn{cls}" href="{href}">{label}</a>' for href, label, cls in buttons)

    # Three themed banners, rotating like Canon India's home carousel (artwork made in Canva can replace the photos later)
    banners = [
        ('light', 'h1', E(SITE['badge']), 'Canon Printing, Copying and Scanning for the Islands',
         'Canon copiers, printers and scanners for the Andaman &amp; Nicobar Islands, with sales, installation and on-site service from Sri Vijaya Puram.',
         [('products/index.html', 'Discover More', ''), ('contact.html#quote', 'Get a Quotation', ' btn-ghost')],
         shots('imageRUNNER 2425')),
        ('dark', 'h2', 'Service &amp; AMC', 'On-Site Service You Can Count On',
         'Installation, annual maintenance contracts and genuine Canon consumables, delivered by our own engineers across the Islands.',
         [('service.html#book', 'Book a Service', ''), ('service.html', 'AMC Plans', ' btn-ghost')],
         shots('imageCLASS MF289dw') + '<p class="bbadge"><b>On-site</b>service</p>'),
        ('grey', 'h2', 'Government Buyers', 'Supplying Government Offices through GeM',
         f'Registered GeM seller (ID {E(SITE["gem_id"])}). Copiers, printers and scanners with tender documents ready.',
         [('government.html', 'Government Orders', ''), ('contact.html#quote', 'Request a Quote', ' btn-ghost')],
         shots('imageFORMULA DR-C240', 'imageCLASS LBP6030B', 'PIXMA G3010')),
    ]
    if any(by_cat[c] for c in CAMERA_CATS):
        banners.insert(1, ('grey', 'h2', 'Cameras &amp; Lenses', 'Canon EOS Cameras, Lenses and PowerShot',
                           'EOS R mirrorless and DSLR cameras, RF lenses, PowerShot compacts, camcorders and Cinema EOS, with Canon India warranty.',
                           [('products/cameras.html', 'Explore Cameras', ''), ('contact.html#quote', 'Get a Quotation', ' btn-ghost')],
                           shots('EOS R6 Mark III', 'EOS R50', 'PowerShot G7 X Mark III')))
    slides_html = ''.join(
        f'<article class="slide bslide bslide-{tone}{" is-on" if i == 0 else ""}" aria-roledescription="slide" aria-label="{i + 1} of {len(banners)}"><div class="wrap bslide-inner">'
        f'<div class="bcopy"><p class="eyebrow">{eyebrow}</p><{tag} class="btitle">{title}</{tag}><p class="lede">{lede}</p>'
        f'<div class="hero-actions">{btns(buttons)}</div></div>'
        f'<div class="bpic">{pics}</div></div></article>'
        for i, (tone, tag, eyebrow, title, lede, buttons, pics) in enumerate(banners))
    tiles = ''.join(f'''<a class="tile" href="{cat_href(c[0])}">{cat_picture(c[0], '')}<span class="tile-name">{c[2]}</span><span class="tile-count">{len(by_cat[c[0]])} models</span><span class="tile-cta">View Products</span></a>'''
                    for c in CATEGORIES if by_cat[c[0]])
    home = f'''
<section class="banner" aria-roledescription="carousel" aria-label="Highlights">
  <div class="slides">{slides_html}</div>
  <div class="reel">{''.join(f'<button class="reel-tick{" is-on" if i == 0 else ""}" aria-label="Show banner {i + 1}"><i></i></button>' for i in range(len(banners)))}</div>
</section>
<section class="why"><div class="wrap">
  <div class="hero-panel">
    <p class="panel-title">Why Buy from AIM</p>
    <ul class="checks">
      <li>Canon Authorized Premium Business Partner with genuine products and full warranty</li>
      <li>Installation and service by our own engineers in Port Blair</li>
      <li>Registered GeM seller for government orders</li>
      <li>Genuine Canon toner, ink and spares kept in stock</li>
    </ul>
  </div>
</div></section>

<section class="section reveal"><div class="wrap">
  <div class="section-head"><h2>Product Range</h2><a href="products/index.html">View All {len(products)} Products</a></div>
  <div class="tiles">{tiles}</div>
</div></section>

<section class="section band reveal"><div class="wrap">
  <div class="section-head"><h2>Featured Products</h2><a href="products/index.html">See Full Range</a></div>
  <div class="grid">{''.join(card(p, '') for p in featured)}</div>
</div></section>

<section class="section reveal"><div class="wrap services">
  <div><h2>More Than a Dealer</h2><p>Buying a copier is the start. We look after it for its whole life, so your office never stops printing.</p><a class="btn btn-ghost" href="service.html">Service &amp; AMC Plans</a></div>
  <ul class="service-list">
    <li><b>Installation &amp; Training</b><span>Set-up, network printing and scanning to email, done on site.</span></li>
    <li><b>Annual Maintenance Contracts</b><span>Comprehensive and non-comprehensive AMC for copiers and printers.</span></li>
    <li><b>Genuine Consumables</b><span>Toner, ink bottles, drums and paper delivered across Sri Vijaya Puram.</span></li>
    <li><b>Warranty Service</b><span>Canon warranty repairs plus Lenovo and Wipro service support.</span></li>
  </ul>
</div></section>

<section class="section band-dark"><div class="wrap cta-row">
  <div><h2>Buying for a Government Office?</h2><p>We supply through GeM and open tenders, with all bid documents ready.</p></div>
  <a class="btn" href="government.html">How We Work with Departments</a>
</div></section>
'''
    page('index.html', 'AIM Enterprises | Canon Printers, Copiers & Service in Port Blair',
         'Canon Authorized Premium Business Partner and Canon Service Edge (CSP) Provider in Sri Vijaya Puram (Port Blair). Canon copiers, printers, scanners, genuine consumables, AMC and service across the Andaman & Nicobar Islands.',
         home, 'Home')

    # ---------- Product listings: printers & scanners, and cameras & lenses ----------
    def listing_page(path, cats, title, intro, placeholder, meta_title, meta_desc, active):
        cats = [c for c in CATEGORIES if c[0] in cats and by_cat[c[0]]]
        count = sum(len(by_cat[c[0]]) for c in cats)
        chips = '<button class="chip" data-filter="all" aria-pressed="true">All</button>' + ''.join(
            f'<button class="chip" data-filter="{c[0]}" aria-pressed="false">{c[2]} <span>{len(by_cat[c[0]])}</span></button>'
            for c in cats)
        sections = ''.join(f'''<section class="cat-block" id="{c[0]}" data-cat="{c[0]}">
  <h2>{E(c[1])}</h2>
  <div class="grid">{''.join(card(p, '../') for p in by_cat[c[0]])}</div>
</section>''' for c in cats)
        other = ('<a href="cameras.html">Looking for cameras and lenses?</a>' if path.endswith('index.html')
                 else '<a href="index.html">Looking for printers, copiers and scanners?</a>')
        listing = f'''
<section class="page-head"><div class="wrap">
  <nav class="crumbs"><a href="../index.html">Home</a> / {E(title)}</nav>
  <h1>{E(title)}</h1>
  <p>{count} {intro} Prices shown are Canon India MRPs including GST. Ask us for the best price on any model. {other}</p>
</div></section>
<div class="wrap catalogue">
  <div class="filters">
    <label class="search"><span class="sr">Search Models</span><input id="q" type="search" placeholder="{E(placeholder)}"></label>
    <div class="chips">{chips}</div>
  </div>
  {sections}
  <p class="empty" hidden>No model matches that search. {other} Or <a href="../contact.html#quote">ask us</a> and we will source it for you.</p>
</div>
'''
        page(path, meta_title, meta_desc, listing, active)

    listing_page('products/index.html', [c[0] for c in CATEGORIES if c[0] not in CAMERA_CATS], 'Canon Products',
                 'models across copiers, printers and scanners.', 'Search a model, e.g. G3010 or 2224',
                 'Canon Printers, Copiers & Scanners with MRP | AIM Enterprises',
                 'Full Canon range with MRP: imageRUNNER copiers, imageCLASS laser, PIXMA ink tank, MAXIFY, imagePROGRAF and imageFORMULA scanners. Delivered and installed in the Andaman & Nicobar Islands.',
                 'Products')
    if any(by_cat[c] for c in CAMERA_CATS):
        listing_page('products/cameras.html', CAMERA_CATS, 'Canon Cameras & Lenses',
                     'Canon cameras, lenses and accessories: EOS R mirrorless, EOS DSLR, PowerShot, RF lenses, camcorders and Cinema EOS.',
                     'Search a model, e.g. R50, G7 X or RF50mm',
                     'Canon EOS Cameras, RF Lenses & PowerShot with MRP | AIM Enterprises',
                     'Canon EOS R mirrorless and DSLR cameras, PowerShot and IXUS compacts, RF lenses, accessories, camcorders and Cinema EOS with Canon India MRP. Genuine Canon India warranty from AIM Enterprises, Port Blair.',
                     'Cameras')

    # ---------- Product pages ----------
    for p in products:
        related = [r for r in by_cat[p['cat']] if r is not p][:4]
        cat = next(c for c in CATEGORIES if c[0] == p['cat'])
        is_cam = p['cat'] in CAMERA_CATS
        list_page, list_name = ('cameras.html', 'Cameras &amp; Lenses') if is_cam else ('index.html', 'Products')
        spec_href = '#specs' if p['specs'] else E(p['canon_url'])
        spec_target = '' if p['specs'] else ' target="_blank" rel="noopener"'
        canon_feats = ''.join(f'<li>{E(f)}</li>' for f in p['features'])
        aim_feats = (['Genuine Canon India product with manufacturer warranty', 'Delivered across Sri Vijaya Puram and the Islands',
                      'Canon service support through AIM', 'Available for GeM and tender orders'] if is_cam else
                     ['Genuine Canon product with manufacturer warranty', 'Delivery and installation in Sri Vijaya Puram',
                      'AMC and consumables available from AIM', 'Available for GeM and tender orders'])
        body = f'''
<div class="wrap">
  <nav class="crumbs"><a href="../index.html">Home</a> / <a href="{list_page}">{list_name}</a> / <a href="{list_page}#{p['cat']}">{E(p['cat_label'])}</a> / {E(p['model'])}</nav>
  <nav class="tabbar"><a href="#overview" class="on">Overview</a><a href="#features">Key Features</a><a href="{spec_href}"{spec_target}>Specifications</a><a href="../contact.html?model={E(p['model'])}#quote">Where to Buy</a>{'<a href="#consumables">Consumables</a>' if fits_map.get(p['model']) else ''}<a href="../support.html">Get Support</a></nav>
  <section class="product" id="overview">
    <div class="product-pic">{picture(p, '../', lazy=False)}</div>
    <div class="product-info">
      <p class="card-cat">Canon · {E(cat[1])}</p>
      <h1>Canon {E(p['model'])}</h1>
      <p class="lede">{E(p['desc'])}</p>
      {price_html(p, note=True)}
      <div class="hero-actions">
        <a class="btn" href="../contact.html?model={E(p['model'])}#quote">Enquire Now</a>
        <a class="btn btn-wa" href="{wa_link(f"Hello AIM Enterprises, please share your best price and availability for Canon {p['model']}.")}" target="_blank" rel="noopener">Ask on WhatsApp</a>
      </div>
      <ul class="checks small-checks" id="features">
        {canon_feats}{''.join(f'<li>{f}</li>' for f in aim_feats)}
      </ul>
      <p class="small">Full specifications and brochure: <a href="{E(p['canon_url'])}" target="_blank" rel="noopener">Canon India product page</a></p>
      <p class="small">Bought this model? <a href="{SITE['register_url']}" target="_blank" rel="noopener">Register your Canon product</a> for warranty support. Drivers, manuals and FAQ are on our <a href="../support.html">Support page</a>.</p>
    </div>
  </section>
  {variants_table(p)}
  {specs_table(p)}
  {'<section class="section reveal" id="consumables"><h2>Genuine Consumables</h2><p>Canon India MRPs, inclusive of all taxes. We keep genuine Canon supplies in stock in Sri Vijaya Puram. <a href="../consumables.html">Full consumables price list</a></p>' + consumables_table(fits_map[p['model']], '../') + '</section>' if fits_map.get(p['model']) else ''}
  {'<section class="section reveal"><h2>Similar Models</h2><div class="grid">' + ''.join(card(r, '../') for r in related) + '</div></section>' if related else ''}
</div>
'''
        price_txt = f"MRP ₹{rupees(p['mrp'])} incl. GST. " if p['mrp'] else ''
        page(f"products/{p['slug']}.html", f"Canon {p['model']} | Price in Port Blair | AIM Enterprises",
             f"Canon {p['model']}: {p['desc']} {price_txt}Buy from AIM Enterprises, Sri Vijaya Puram."[:300],
             body, 'Cameras' if is_cam else 'Products')

    # ---------- Consumables ----------
    by_group = {g[0]: [c for c in consumables if c['group'] == g[0]] for g in CONSUMABLE_GROUPS}
    for g in by_group.values():
        g.sort(key=lambda c: c['name'].lower())
    cchips = '<button class="chip" data-filter="all" aria-pressed="true">All</button>' + ''.join(
        f'<button class="chip" data-filter="{g[0]}" aria-pressed="false">{g[2]} <span>{len(by_group[g[0]])}</span></button>'
        for g in CONSUMABLE_GROUPS if by_group[g[0]])
    csections = ''.join(f'''<section class="cat-block" id="{g[0]}" data-cat="{g[0]}">
  <h2>{E(g[1])}</h2>
  <div class="grid">{''.join(ccard(c, '') for c in by_group[g[0]])}</div>
</section>''' for g in CONSUMABLE_GROUPS if by_group[g[0]])
    cpage = f'''
<section class="page-head"><div class="wrap">
  <nav class="crumbs"><a href="index.html">Home</a> / Consumables</nav>
  <h1>Canon Consumables Price List</h1>
  <p>{len(consumables)} genuine Canon toners, copier drums, ink bottles, ink cartridges, plotter inks, print heads, maintenance cartridges and scanner rollers. Prices are Canon India MRPs including GST. Search by your printer model to find the right supply, and ask us for the best price.</p>
</div></section>
<div class="wrap catalogue">
  <div class="filters">
    <label class="search"><span class="sr">Search Consumables</span><input id="q" type="search" placeholder="Search a printer or supply, e.g. G3010, GI-71 or 925"></label>
    <div class="chips">{cchips}</div>
  </div>
  {csections}
  <p class="empty" hidden>No consumable matches that search. <a href="contact.html#quote">Ask Us</a> and we will source it for you.</p>
  <p class="small">Copier toners (NPG and T series) and drums for imageRUNNER and imageFORCE machines, and scanner roller kits, are listed at Canon's MRP. Call us with your machine model if you cannot find yours.</p>
</div>
'''
    page('consumables.html', 'Canon Ink, Toner & Consumables Price List | AIM Enterprises',
         'Genuine Canon ink bottles, toner cartridges, print heads and photo paper with Canon India MRP. In stock at AIM Enterprises, Sri Vijaya Puram (Port Blair).',
         cpage, 'Consumables')

    # ---------- Service ----------
    service = f'''
<section class="page-head"><div class="wrap">
  <nav class="crumbs"><a href="index.html">Home</a> / Service &amp; AMC</nav>
  <p class="eyebrow">Canon Service Edge (CSP) Provider</p>
  <h1>Service and Maintenance</h1>
  <p>As Canon's authorised service partner, our engineers keep Canon copiers and printers running across Sri Vijaya Puram and the nearby islands.</p>
</div></section>
<div class="wrap">
  <section class="section two-col">
    <div class="prose">
      <h2>What We Cover</h2>
      <ul class="checks">
        <li>Canon warranty repairs on copiers, printers and scanners</li>
        <li>Comprehensive AMC: parts, labour and consumables in one yearly fee</li>
        <li>Non-comprehensive AMC: scheduled visits and labour, parts charged as used</li>
        <li>Per-call service for machines outside contract</li>
        <li>Genuine toner, drums, ink bottles and paper</li>
        <li>Lenovo and Wipro desktop and laptop service support</li>
        <li>Network printing, scan-to-email and scan-to-folder set-up</li>
      </ul>
      <p>Out of warranty? See Canon India's <a href="{SITE['labour_url']}" target="_blank" rel="noopener">service labour charges</a> before you book.</p>
      <h2>Register Your Canon Product</h2>
      <p>Register your new Canon machine with Canon India to activate warranty support and get service updates.</p>
      <p><a class="btn" href="{SITE['register_url']}" target="_blank" rel="noopener">Register on Canon India</a></p>
    </div>
    <form class="form" id="book" data-kind="service">
      <h2>Book a Service Visit</h2>
      <label>Name<input name="name" required autocomplete="name"></label>
      <label>Office or Organisation<input name="org"></label>
      <label>Phone<input name="phone" type="tel" required autocomplete="tel"></label>
      <label>Machine Model<input name="model" placeholder="e.g. imageRUNNER 2425"></label>
      <label>Problem<textarea name="message" rows="3" placeholder="Paper jam, error code, print quality…"></textarea></label>
      <div class="form-actions"><button class="btn btn-wa" type="submit" data-via="whatsapp">Send on WhatsApp</button><button class="btn btn-ghost" type="submit" data-via="email">Send by Email</button></div>
    </form>
  </section>
</div>
'''
    page('service.html', 'Canon Copier Service & AMC in Port Blair | AIM Enterprises',
         'Canon copier and printer service, AMC plans, genuine toner and warranty repairs in Sri Vijaya Puram (Port Blair), Andaman & Nicobar Islands.',
         service, 'Service & AMC')

    # ---------- Support ----------
    support = f'''
<section class="page-head"><div class="wrap">
  <nav class="crumbs"><a href="index.html">Home</a> / Support</nav>
  <p class="eyebrow">Canon Service Edge (CSP) Provider</p>
  <h1>Product Support</h1>
  <p>Drivers, manuals, specifications and answers for your Canon product, straight from Canon India. Need a technician? Our engineers are a call away.</p>
</div></section>
<div class="wrap">
  <section class="section">
    <h2>Canon Online Support</h2>
    <div class="support-grid"><a class="support-card" href="{SITE['canon_listing_url']}" target="_blank" rel="noopener"><b>Canon Authorisation</b><span>Our official Canon Authorised Dealer listing on Canon India.</span><em>Verify on Canon India</em></a>{''.join(f'<a class="support-card" href="{E(l["url"])}" target="_blank" rel="noopener"><b>{E(l["title"])}</b><span>{E(l["text"])}</span><em>Open on Canon India</em></a>' for l in SITE['support_links'])}
      <a class="support-card" href="service.html#book"><b>Book a Service Visit</b><span>On-site repair and maintenance by AIM engineers in Sri Vijaya Puram.</span><em>Book with AIM</em></a>
    </div>
  </section>
  <section class="section">
    <h2>Follow Canon India</h2>
    <p>Product launches, tips and offers from Canon India's official social media accounts.</p>
    <div class="social-row social-light">{social_links()}</div>
  </section>
  <section class="section callout">
    <h2>Talk to Our Service Team</h2>
    <p>Mobile: <a href="tel:{SITE['phone_tel']}">{E(SITE['phone_display'])}</a><br>Landline: {' / '.join(f'<a href="tel:{l["tel"]}">{E(l["display"])}</a>' for l in SITE['landlines'])}<br>Canon virtual no.: <a href="tel:{SITE['canon_virtual']['tel']}">{E(SITE['canon_virtual']['display'])}</a></p>
    <p><a href="{wa_link('Hello AIM Enterprises, I need support for my Canon product.')}" target="_blank" rel="noopener">Chat on WhatsApp</a></p>
  </section>
</div>
'''
    page('support.html', 'Canon Product Support | Drivers, Manuals, FAQ | AIM Enterprises',
         'Canon drivers, manuals, specifications, FAQ and product registration, plus on-site service from AIM Enterprises in Sri Vijaya Puram (Port Blair).',
         support, 'Support')

    # ---------- Government ----------
    gov = f'''
<section class="page-head"><div class="wrap">
  <nav class="crumbs"><a href="index.html">Home</a> / Government Buyers</nav>
  <h1>Supplying Government Departments</h1>
  <p>We have supplied and serviced Canon equipment for departments in the Andaman &amp; Nicobar Islands through GeM and open tenders.</p>
</div></section>
<div class="wrap">
  <section class="section facts">
    <div><span class="fact-label">GeM Seller ID</span><span class="fact">{E(SITE['gem_id'])}</span></div>
    <div><span class="fact-label">GSTIN</span><span class="fact">{E(SITE['gstin'])}</span></div>
    <div><span class="fact-label">Location</span><span class="fact">Sri Vijaya Puram, A&amp;N Islands</span></div>
  </section>
  <section class="section two-col">
    <div class="prose">
      <h2>How We Help</h2>
      <ul class="checks">
        <li>Canon products listed on GeM for direct purchase and bids</li>
        <li>Manufacturer authorisation (MAF) from Canon India on request</li>
        <li>Integrity pact, declarations and bidder forms prepared promptly</li>
        <li>Local installation, training and AMC after supply</li>
        <li>Quotations for budget estimates and file approvals</li>
      </ul>
    </div>
    <div class="callout">
      <h2>Need a Budgetary Quote?</h2>
      <p>Send the specification or the GeM bid number and we will reply with a quotation on our letterhead.</p>
      <a class="btn" href="contact.html#quote">Request Quotation</a>
    </div>
  </section>
</div>
'''
    page('government.html', 'GeM Seller for Canon Products in Andaman | AIM Enterprises',
         'AIM Enterprises supplies Canon copiers, printers and scanners to government departments in the Andaman & Nicobar Islands through GeM and tenders.',
         gov, 'Government Buyers')

    # ---------- About ----------
    about = f'''
<section class="page-head"><div class="wrap">
  <nav class="crumbs"><a href="index.html">Home</a> / About</nav>
  <p class="eyebrow">Canon Authorized Premium Business Partner · Canon Service Edge (CSP) Provider</p>
  <h1>About AIM Enterprises</h1>
  <p>Canon sales, service and support for the Andaman &amp; Nicobar Islands, from our shop on MG Road, Middle Point, Sri Vijaya Puram.</p>
</div></section>
<div class="wrap">
  <section class="section two-col">
    <div class="prose">
      <p class="lede">AIM Enterprises is a Canon Authorized Premium Business Partner and Canon Service Edge (CSP) Provider based in Sri Vijaya Puram (Port Blair). We help offices, schools, banks, businesses and government departments across the Andaman &amp; Nicobar Islands choose, install and run the right Canon equipment.</p>
      <p>Being on the islands means our customers cannot wait for an engineer or a spare part to arrive from the mainland. That is why we keep Canon stock, genuine consumables, spare parts and trained service engineers right here in Sri Vijaya Puram. A machine bought from AIM is installed, supported and maintained locally for its whole working life.</p>
      <p>As a Canon Service Edge (CSP) Provider, we handle Canon warranty repairs and offer Annual Maintenance Contracts, so one local partner looks after both the purchase and the service.</p>
    </div>
    <div class="callout">
      <h2>At a Glance</h2>
      <ul class="checks">
        <li>Canon Authorized Premium Business Partner</li>
        <li>Canon Service Edge (CSP) Provider</li>
        <li>Full Canon range at Canon India MRP</li>
        <li>Local stock, spares and service engineers</li>
        <li>Registered GeM seller (ID {E(SITE['gem_id'])})</li>
        <li>GSTIN {E(SITE['gstin'])}</li>
      </ul>
      <p><a class="btn" href="{SITE['canon_listing_url']}" target="_blank" rel="noopener">Verify Our Canon Authorisation</a></p>
      <p class="small">Opens AIM Enterprises' official listing on Canon India's authorised dealer site.</p>
    </div>
  </section>

  <section class="section">
    <h2>What We Do</h2>
    <ul class="service-list about-list">
      <li><b>Canon Products</b><span>Office multifunction copiers (imageRUNNER and imageFORCE), imageCLASS laser printers, PIXMA ink tank printers, MAXIFY business inkjets, imagePROGRAF large format printers, imageFORMULA document scanners, CanoScan scanners, cheque scanners and SELPHY photo printers.</span></li>
      <li><b>Service &amp; AMC</b><span>Canon warranty repairs, comprehensive and non-comprehensive AMC, per-call service, and network printing and scanning set-up, all on site.</span></li>
      <li><b>Genuine Consumables</b><span>Canon toner, drums, ink bottles and paper, kept in stock and delivered across Sri Vijaya Puram.</span></li>
      <li><b>Government &amp; GeM Supply</b><span>Canon products on GeM for direct purchase and bids, with tender documents and Canon manufacturer authorisation on request.</span></li>
      <li><b>IT Peripherals</b><span>SSDs, UPS units, monitors, keyboards and other computer accessories for offices.</span></li>
      <li><b>Lenovo &amp; Wipro Service</b><span>Service support for Lenovo and Wipro desktops and laptops.</span></li>
    </ul>
  </section>

  <section class="section two-col">
    <div class="prose">
      <h2>Why Customers Choose AIM</h2>
      <ul class="checks">
        <li>Genuine Canon products with full manufacturer warranty</li>
        <li>Engineers based on the islands, not flown in</li>
        <li>Installation and user training included with every machine</li>
        <li>One partner for sales, service, consumables and AMC</li>
        <li>Quick quotations for budgets, file approvals and tenders</li>
      </ul>
    </div>
    <div class="callout">
      <h2>Visit or Call Us</h2>
      <address>{'<br>'.join(E(l) for l in SITE['address_lines'])}</address>
      {hours_html()}
      <p>Mobile: <a href="tel:{SITE['phone_tel']}">{E(SITE['phone_display'])}</a><br>Landline: {' / '.join(f'<a href="tel:{l["tel"]}">{E(l["display"])}</a>' for l in SITE['landlines'])}<br>Canon virtual no.: <a href="tel:{SITE['canon_virtual']['tel']}">{E(SITE['canon_virtual']['display'])}</a><br>Email: <a href="mailto:{SITE['email']}">{E(SITE['email'])}</a></p>
      <p><a class="btn btn-ghost" href="contact.html#quote">Request a Quotation</a></p>
    </div>
  </section>
</div>
'''
    page('about.html', 'About AIM Enterprises | Canon Partner, Sri Vijaya Puram',
         'AIM Enterprises is a Canon partner in Sri Vijaya Puram (Port Blair) selling and servicing Canon office equipment across the Andaman & Nicobar Islands.',
         about, 'About')

    # ---------- Contact ----------
    options = ''.join(f'<option>{E(p["model"])}</option>' for p in products)
    contact = f'''
<section class="page-head"><div class="wrap">
  <nav class="crumbs"><a href="index.html">Home</a> / Contact</nav>
  <h1>Contact Us</h1>
  <p>Call, WhatsApp or send a quotation request. We reply the same working day.</p>
</div></section>
<div class="wrap">
  <section class="section two-col">
    <div class="contact-cards">
      <div class="callout"><h2>Visit</h2><address>{'<br>'.join(E(l) for l in SITE['address_lines'])}</address>{hours_html()}<a href="{E(SITE['maps_url'])}" target="_blank" rel="noopener">Open in Google Maps</a></div>
      <div class="callout"><h2>Call or WhatsApp</h2><p>Mobile: <a href="tel:{SITE['phone_tel']}">{E(SITE['phone_display'])}</a><br>Landline: {' / '.join(f'<a href="tel:{l["tel"]}">{E(l["display"])}</a>' for l in SITE['landlines'])}<br>Canon virtual no.: <a href="tel:{SITE['canon_virtual']['tel']}">{E(SITE['canon_virtual']['display'])}</a></p><p><a href="{wa_link('Hello AIM Enterprises, I have an enquiry.')}" target="_blank" rel="noopener">Chat on WhatsApp</a></p></div>
      <div class="callout"><h2>Email</h2><p><a href="mailto:{SITE['email']}">{E(SITE['email'])}</a></p></div>
    </div>
    <form class="form" id="quote" data-kind="quote">
      <h2>Request a Quotation</h2>
      <label>Name<input name="name" required autocomplete="name"></label>
      <label>Office or Organisation<input name="org"></label>
      <label>Phone<input name="phone" type="tel" required autocomplete="tel"></label>
      <label>Email<input name="email" type="email" autocomplete="email"></label>
      <label>Model<input name="model" list="models" placeholder="Start typing a model"></label>
      <datalist id="models">{options}</datalist>
      <label>Quantity<input name="qty" type="number" min="1" value="1"></label>
      <label>Message<textarea name="message" rows="3" placeholder="Accessories, delivery location, GeM bid number…"></textarea></label>
      <div class="form-actions"><button class="btn btn-wa" type="submit" data-via="whatsapp">Send on WhatsApp</button><button class="btn btn-ghost" type="submit" data-via="email">Send by Email</button></div>
    </form>
  </section>
</div>
'''
    page('contact.html', 'Contact AIM Enterprises | Canon Dealer in Port Blair',
         'Contact AIM Enterprises, MG Road, Middle Point, Sri Vijaya Puram (Port Blair). Call, WhatsApp or request a quotation for Canon products.',
         contact, 'Contact')

    # ---------- Sitemap / robots / data for search ----------
    base = SITE['url'].rstrip('/')
    urls = ['', 'products/', 'products/cameras.html', 'consumables.html', 'service.html', 'government.html', 'about.html', 'contact.html', 'support.html'] + [f"products/{p['slug']}.html" for p in products]
    with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        f.writelines(f'  <url><loc>{base}/{u}</loc></url>\n' for u in urls)
        f.write('</urlset>\n')
    with open(os.path.join(ROOT, 'robots.txt'), 'w') as f:
        f.write(f'User-agent: *\nAllow: /\nSitemap: {base}/sitemap.xml\n')
    print(f'Built {len(products)} product pages + 8 site pages ({len(consumables)} consumables).')


if __name__ == '__main__':
    build()
