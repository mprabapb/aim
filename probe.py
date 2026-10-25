import os, re, json, urllib.request, urllib.error
os.makedirs('out', exist_ok=True)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
def get(url):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30).read().decode('utf-8','replace')
    except Exception as e:
        return 'ERR '+str(e)
B='https://in.canon/en/consumer/products/search/json?category=printing&subCategory=inkjet-printers'
out=[]
for q in ['&max=30&page=2','&page=2','&max=12&page=2','&max=30&page=3','&offset=12','&start=12','&p=2','&max=30&page=2&ajax=true','&max=30&offset=12','&pageNumber=2','&max=30&page=1&sort=name']:
    s=get(B+q)
    try:
        d=json.loads(s); out.append(f"{q}: n={len(d['results'])} more={d.get('hasMore')} first={d['results'][0]['name'] if d['results'] else None}")
    except Exception: out.append(f"{q}: {s[:200]}")
page=get('https://in.canon/en/consumer/products/search?category=printing&subCategory=inkjet-printers')
js=re.findall(r'src="(/assets/[^"]+\.js)"',page)
out.append('JS: '+' '.join(js))
for j in js:
    s=get('https://in.canon'+j)
    for m in re.finditer(r'load-more|loadMore|hasMore',s):
        out.append(j+' :: '+s[max(0,m.start()-800):m.start()+800].replace('\n',' '))
open('out/report.txt','w').write('\n\n'.join(out))
