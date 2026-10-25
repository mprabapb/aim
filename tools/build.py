#!/usr/bin/env python3
"""Generate the AIM Enterprises static site from data/site.json and data/products.csv.

Run from the repo root:  python3 tools/build.py
Edit the CSV (prices, descriptions) or site.json (contact details), then run it again.
"""
import csv, html, json, os, re
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
]
CAT_BY_NAME = {c[1]: c for c in CATEGORIES}


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


def load_products():
    rows = []
    with open(os.path.join(ROOT, 'data', 'products.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            cat = CAT_BY_NAME[r['Category']]
            price = r['MRP (Rs, incl. GST)'].strip()
            rows.append({
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


def wa_link(text):
    from urllib.parse import quote
    return f"https://wa.me/{SITE['whatsapp']}?text={quote(text)}"


# Two-row header like Canon India: segments in the grey band, everyday links in the white row below
SEGMENTS = [('products/index.html', 'Printers & Scanners'), ('service.html', 'Service & AMC'), ('government.html', 'Government (GeM)')]
NAV = [('products/index.html', 'Products'), ('contact.html', 'Where to Buy'), ('service.html', 'Service Network'),
       ('service.html#book', 'Book a Service'), ('government.html', 'GeM Orders'), ('about.html', 'About Us'), ('contact.html', 'Contact')]
SEGMENT_FOR = {'Service & AMC': 'Service & AMC', 'Government Buyers': 'Government (GeM)'}


def page(path, title, desc, body, active=''):
    depth = path.count('/')
    up = '../' * depth
    seg_on = SEGMENT_FOR.get(active, 'Printers & Scanners')
    segments = ''.join(f'<a href="{up}{href}"{" class=\"on\"" if label == seg_on else ""}>{E(label)}</a>' for href, label in SEGMENTS)
    nav = ''.join(f'<a href="{up}{href}">{E(label)}</a>' for href, label in NAV)
    ld = {
        '@context': 'https://schema.org', '@type': 'LocalBusiness', 'name': SITE['name'],
        'description': SITE['tagline'], 'telephone': [SITE['phone_display']] + [l['display'] for l in SITE['landlines']], 'email': SITE['email'],
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@400;700&family=Figtree:wght@400;500&display=swap">
<link rel="stylesheet" href="{up}assets/style.css">
<link rel="icon" href="{up}assets/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">{json.dumps(ld)}</script>
</head>
<body data-wa="{SITE['whatsapp']}" data-email="{SITE['email']}">
<header class="site-header">
<div class="brandbar"><div class="wrap">
  <a class="brand" href="{up}index.html"><img src="{up}assets/logo.svg" alt="AIM Enterprises, Canon Authorized Premium Partner" width="170" height="44"></a>
  <span class="brand-place">Andaman &amp; Nicobar</span>
  <nav class="segments" aria-label="Sections">{segments}</nav>
  <span class="bar-divider" aria-hidden="true"></span>
  <a class="search-link" href="{up}products/index.html#search" aria-label="Search products"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M15.6 15.6 21 21" stroke="currentColor" stroke-width="1.4"/></svg></a>
  <a class="bar-accent" href="tel:{SITE['phone_tel']}">Call Us</a>
  <button class="nav-toggle" aria-expanded="false" aria-controls="nav">Menu</button>
</div></div>
<div class="menubar"><div class="wrap">
  <nav id="nav" aria-label="Main">{nav}</nav>
  <div class="menu-right">
    <a href="{up}service.html">AMC</a><a href="{up}contact.html">Support</a>
    <span class="bar-divider" aria-hidden="true"></span>
    <a class="quote-link" href="{up}contact.html#quote"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 3h3l2.6 12.2a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="9.5" cy="20" r="1.4" fill="currentColor"/><circle cx="17.5" cy="20" r="1.4" fill="currentColor"/></svg>Get a Quote</a>
  </div>
</div></div>
<div class="megamenu"><div class="wrap">{''.join(f'<a href="{up}products/index.html#{c[0]}">{cat_picture(c[0], up)}<span>{c[2]}</span></a>' for c in CATEGORIES)}</div></div>
</header>
<main>
{body}
</main>
<footer class="site-footer"><div class="wrap footer-grid">
  <div>
    <img src="{up}assets/logo.svg" alt="AIM Enterprises" width="170" height="44">
    <p class="partner-badge">{E(SITE['badge'])}</p>
    <p>{E(SITE['tagline'])}</p>
    <p class="small">GSTIN {E(SITE['gstin'])} · PAN {E(SITE['pan'])} · GeM Seller ID {E(SITE['gem_id'])}</p>
  </div>
  <div>
    <h3>Products</h3>
    {''.join(f'<a href="{up}products/index.html#{c[0]}">{c[2]}</a>' for c in CATEGORIES[:6])}
  </div>
  <div>
    <h3>Company</h3>
    <a href="{up}service.html">Service &amp; AMC</a><a href="{up}government.html">Government Buyers</a><a href="{up}about.html">About Us</a><a href="{up}contact.html">Contact</a>
  </div>
  <div>
    <h3>Visit Us</h3>
    <address>{'<br>'.join(E(l) for l in SITE['address_lines'])}</address>
    <a href="tel:{SITE['phone_tel']}">{E(SITE['phone_display'])}</a>
    {''.join(f'<a href="tel:{l["tel"]}">{E(l["display"])}</a>' for l in SITE['landlines'])}
    <a href="mailto:{SITE['email']}">{E(SITE['email'])}</a>
  </div>
</div>
<div class="wrap legal">© {date.today().year} AIM Enterprises, Sri Vijaya Puram. Product photos © Canon India. Canon, imageRUNNER, imageFORCE, imageCLASS, PIXMA, MAXIFY, imagePROGRAF and imageFORMULA are trademarks of Canon Inc. MRPs are as published by Canon India and may change without notice.</div>
</footer>
<a class="wa-float" href="{wa_link('Hello AIM Enterprises, I have an enquiry.')}" target="_blank" rel="noopener" aria-label="Chat on WhatsApp">{WA_ICON}</a>
<script src="{up}assets/site.js" defer></script>
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
    return f'<img class="photo" src="{up}assets/products/{f}" alt="Canon {E(p["model"])}"{" loading=\"lazy\"" if lazy else ""}>'


CAT_PHOTO = {}  # category -> product whose photo stands for the category


def cat_picture(cat, up):
    p = CAT_PHOTO.get(cat)
    return picture(p, up) if p else icon(cat)


def price_html(p):
    if p['mrp']:
        return f'<p class="price">MRP Rs. {rupees(p["mrp"])}.00/U<span class="price-note">inclusive of all taxes</span></p>'
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


def build():
    products = load_products()
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
    slides_html = ''.join(
        f'<article class="slide bslide bslide-{tone}{" is-on" if i == 0 else ""}" aria-roledescription="slide" aria-label="{i + 1} of {len(banners)}"><div class="wrap bslide-inner">'
        f'<div class="bcopy"><p class="eyebrow">{eyebrow}</p><{tag} class="btitle">{title}</{tag}><p class="lede">{lede}</p>'
        f'<div class="hero-actions">{btns(buttons)}</div></div>'
        f'<div class="bpic">{pics}</div></div></article>'
        for i, (tone, tag, eyebrow, title, lede, buttons, pics) in enumerate(banners))
    tiles = ''.join(f'''<a class="tile" href="products/index.html#{c[0]}">{cat_picture(c[0], '')}<span class="tile-name">{c[2]}</span><span class="tile-count">{len(by_cat[c[0]])} models</span><span class="tile-cta">View Products</span></a>'''
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

    # ---------- Product listing ----------
    chips = '<button class="chip" data-filter="all" aria-pressed="true">All</button>' + ''.join(
        f'<button class="chip" data-filter="{c[0]}" aria-pressed="false">{c[2]} <span>{len(by_cat[c[0]])}</span></button>'
        for c in CATEGORIES if by_cat[c[0]])
    sections = ''.join(f'''<section class="cat-block" id="{c[0]}" data-cat="{c[0]}">
  <h2>{E(c[1])}</h2>
  <div class="grid">{''.join(card(p, '../') for p in by_cat[c[0]])}</div>
</section>''' for c in CATEGORIES if by_cat[c[0]])
    listing = f'''
<section class="page-head"><div class="wrap">
  <nav class="crumbs"><a href="../index.html">Home</a> / Products</nav>
  <h1>Canon Products</h1>
  <p>{len(products)} models across copiers, printers and scanners. Prices shown are Canon India MRPs including GST. Ask us for the best price on any model.</p>
</div></section>
<div class="wrap catalogue">
  <div class="filters">
    <label class="search"><span class="sr">Search Models</span><input id="q" type="search" placeholder="Search a model, e.g. G3010 or 2224"></label>
    <div class="chips">{chips}</div>
  </div>
  {sections}
  <p class="empty" hidden>No model matches that search. <a href="../contact.html#quote">Ask Us</a> and we will source it for you.</p>
</div>
'''
    page('products/index.html', 'Canon Printers, Copiers & Scanners with MRP | AIM Enterprises',
         'Full Canon range with MRP: imageRUNNER copiers, imageCLASS laser, PIXMA ink tank, MAXIFY, imagePROGRAF and imageFORMULA scanners. Delivered and installed in the Andaman & Nicobar Islands.',
         listing, 'Products')

    # ---------- Product pages ----------
    for p in products:
        related = [r for r in by_cat[p['cat']] if r is not p][:4]
        cat = next(c for c in CATEGORIES if c[0] == p['cat'])
        body = f'''
<div class="wrap">
  <nav class="crumbs"><a href="../index.html">Home</a> / <a href="index.html">Products</a> / <a href="index.html#{p['cat']}">{E(p['cat_label'])}</a> / {E(p['model'])}</nav>
  <nav class="tabbar"><a href="#overview" class="on">Overview</a><a href="#features">Key Features</a><a href="{E(p['canon_url'])}" target="_blank" rel="noopener">Specifications</a><a href="../contact.html?model={E(p['model'])}#quote">Where to Buy</a><a href="../service.html">Get Support</a></nav>
  <section class="product" id="overview">
    <div class="product-pic">{picture(p, '../', lazy=False)}</div>
    <div class="product-info">
      <p class="card-cat">Canon · {E(cat[1])}</p>
      <h1>Canon {E(p['model'])}</h1>
      <p class="lede">{E(p['desc'])}</p>
      {price_html(p)}
      <div class="hero-actions">
        <a class="btn" href="../contact.html?model={E(p['model'])}#quote">Enquire Now</a>
        <a class="btn btn-wa" href="{wa_link(f"Hello AIM Enterprises, please share your best price and availability for Canon {p['model']}.")}" target="_blank" rel="noopener">Ask on WhatsApp</a>
      </div>
      <ul class="checks small-checks" id="features">
        <li>Genuine Canon product with manufacturer warranty</li>
        <li>Delivery and installation in Sri Vijaya Puram</li>
        <li>AMC and consumables available from AIM</li>
        <li>Available for GeM and tender orders</li>
      </ul>
      <p class="small">Full specifications and brochure: <a href="{E(p['canon_url'])}" target="_blank" rel="noopener">Canon India product page</a></p>
    </div>
  </section>
  {'<section class="section reveal"><h2>Similar Models</h2><div class="grid">' + ''.join(card(r, '../') for r in related) + '</div></section>' if related else ''}
</div>
'''
        price_txt = f"MRP ₹{rupees(p['mrp'])} incl. GST. " if p['mrp'] else ''
        page(f"products/{p['slug']}.html", f"Canon {p['model']} | Price in Port Blair | AIM Enterprises",
             f"Canon {p['model']}: {p['desc']} {price_txt}Buy from AIM Enterprises, Sri Vijaya Puram."[:300],
             body, 'Products')

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
    <div><span class="fact-label">PAN</span><span class="fact">{E(SITE['pan'])}</span></div>
    <div><span class="fact-label">Constitution</span><span class="fact">Sole Proprietorship</span></div>
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
  <h1>About AIM Enterprises</h1>
</div></section>
<div class="wrap">
  <section class="section two-col">
    <div class="prose">
      <p class="lede">AIM Enterprises is a {E(SITE['badge'])} based in Sri Vijaya Puram (Port Blair). We sell, install and service Canon office equipment for businesses, schools, banks and government departments across the Andaman &amp; Nicobar Islands.</p>
      <p>Being on the islands means our customers cannot wait for a service engineer to fly in. We keep stock, spares and trained people here, so a machine bought from us is looked after locally for its whole working life.</p>
      <p>Alongside Canon, we supply IT peripherals such as SSDs, UPS units, monitors and keyboards, and provide Lenovo and Wipro service support.</p>
    </div>
    <div class="callout">
      <h2>At a Glance</h2>
      <ul class="checks">
        <li>Canon sales, service and consumables</li>
        <li>Registered GeM seller</li>
        <li>Shop on MG Road, Middle Point</li>
      </ul>
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
      <div class="callout"><h2>Visit</h2><address>{'<br>'.join(E(l) for l in SITE['address_lines'])}</address><a href="{E(SITE['maps_url'])}" target="_blank" rel="noopener">Open in Google Maps</a></div>
      <div class="callout"><h2>Call or WhatsApp</h2><p>Mobile: <a href="tel:{SITE['phone_tel']}">{E(SITE['phone_display'])}</a><br>Landline: {' / '.join(f'<a href="tel:{l["tel"]}">{E(l["display"])}</a>' for l in SITE['landlines'])}</p><p><a href="{wa_link('Hello AIM Enterprises, I have an enquiry.')}" target="_blank" rel="noopener">Chat on WhatsApp</a></p></div>
      <div class="callout"><h2>Email</h2><p><a href="mailto:{SITE['email']}">{E(SITE['email'])}</a></p><p class="small">{E(SITE['hours'])}</p></div>
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
    urls = ['', 'products/', 'service.html', 'government.html', 'about.html', 'contact.html'] + [f"products/{p['slug']}.html" for p in products]
    with open(os.path.join(ROOT, 'sitemap.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        f.writelines(f'  <url><loc>{base}/{u}</loc></url>\n' for u in urls)
        f.write('</urlset>\n')
    with open(os.path.join(ROOT, 'robots.txt'), 'w') as f:
        f.write(f'User-agent: *\nAllow: /\nSitemap: {base}/sitemap.xml\n')
    print(f'Built {len(products)} product pages + 6 site pages.')


if __name__ == '__main__':
    build()
