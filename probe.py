import json, os, urllib.request
from playwright.sync_api import sync_playwright
os.makedirs('out', exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
def raw(url, name):
    try:
        d = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30).read()
        open('out/raw-'+name+'.html','wb').write(d)
    except Exception as e:
        open('out/raw-'+name+'.err','w').write(str(e))
raw('https://in.canon/en/consumer/pixma-e3370/black/product','pixma')
raw('https://in.canon/en/business/imageforce-1440/main/product','iforce')
raw('https://in.canon/en/consumer/products/search?category=printing&subCategory=inkjet-printers','search')
pages = {
 'search-inkjet':'https://in.canon/en/consumer/products/search?category=printing&subCategory=inkjet-printers',
 'business-home':'https://in.canon/en/business',
}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(user_agent=UA)
    for name,url in pages.items():
        log=[]
        def onresp(r, log=log):
            ct=r.headers.get('content-type','')
            if 'json' in ct or 'api' in r.url:
                try: body=r.text()[:20000]
                except Exception: body=''
                log.append({'url':r.url,'status':r.status,'ct':ct,'body':body})
        pg.on('response', onresp)
        pg.goto(url, wait_until='networkidle', timeout=90000)
        pg.wait_for_timeout(5000)
        open(f'out/pw-{name}.html','w').write(pg.content())
        json.dump(log, open(f'out/net-{name}.json','w'), indent=1)
        pg.remove_listener('response', onresp)
    b.close()
