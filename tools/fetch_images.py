#!/usr/bin/env python3
"""Download each product's main photo from its Canon India page into assets/products/.

Run from the repo root:  python3 tools/fetch_images.py
Skips models that already have a photo. Uses the page's og:image (Canon's main product shot).
"""
import csv, os, re, sys, time, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import slugify  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'products')
UA = {'User-Agent': 'Mozilla/5.0 (AIM Enterprises catalogue image sync)'}


def get(url):
    url = urllib.parse.quote(url, safe=':/%?=&#')  # Canon file names can contain spaces or brackets
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main():
    os.makedirs(OUT, exist_ok=True)
    have = {os.path.splitext(f)[0] for f in os.listdir(OUT)}
    rows = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'products.csv'), encoding='utf-8')))
    missing = []
    for r in rows:
        slug = slugify(r['Model'])
        if slug in have:
            continue
        try:
            page = get(r['Canon India page']).decode('utf-8', 'replace')
            m = (re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', page)
                 or re.search(r'<meta[^>]+content="([^"]+)"[^>]+property="og:image"', page)
                 or re.search(r'(https://in\.canon/media/image/[^"\'\s]+\.(?:png|jpg|jpeg|webp))', page))
            if not m:
                missing.append(r['Model'])
                continue
            src = m.group(1).replace('&amp;', '&')
            if src.startswith('/'):
                src = 'https://in.canon' + src
            ext = os.path.splitext(src.split('?')[0])[1].lower() or '.png'
            data = get(src)
            with open(os.path.join(OUT, slug + ext), 'wb') as f:
                f.write(data)
            print('ok  ', r['Model'], src)
        except Exception as e:  # keep going; report at the end
            missing.append(f"{r['Model']} ({e})")
        time.sleep(1.5)  # be gentle with Canon's server
    print(f'\nDone. {len(missing)} without a photo:')
    for m in missing:
        print('  -', m)


if __name__ == '__main__':
    main()
