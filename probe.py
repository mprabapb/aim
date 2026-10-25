import os, urllib.request, urllib.error
os.makedirs('out', exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
def raw(url, name, hdr={}):
    try:
        r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, **hdr}), timeout=30)
        open('out/'+name,'wb').write(f'{r.status} {r.geturl()}\n'.encode()+r.read())
    except urllib.error.HTTPError as e:
        open('out/'+name,'wb').write(f'HTTP {e.code} {e.geturl()}\n'.encode()+e.read()[:3000])
    except Exception as e:
        open('out/'+name,'w').write('ERR '+str(e))
B='https://in.canon/en/'
raw(B+'consumer/products/search/json?category=printing&subCategory=inkjet-printers&max=30&page=1','inkjet1.json')
raw(B+'consumer/products/search/json?category=printing&subCategory=inkjet-printers&max=30&page=2','inkjet2.json')
raw(B+'consumer/products/search/json?category=printing&subCategory=inkjet-printers&max=100&page=1','inkjet100.json')
raw(B+'business/products/search/json?category=printing&subCategory=multi-functional-devices&max=30&page=1','mfd1.json')
raw(B+'consumer/products/search/json?category=printing&subCategory=inkjet-printers&max=30&page=1','inkjet1x.json',{'X-Requested-With':'XMLHttpRequest','Accept':'application/json'})
raw(B+'consumer/pixma-nonexistent-9999/main/product','missing.html')
raw(B+'consumer/pixma-e3370/main/product','e3370-mainvariant.html')
