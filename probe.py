import os, re, json, time, urllib.request, html
os.makedirs('out', exist_ok=True)
UA = 'Mozilla/5.0 (AIM Enterprises catalogue sync; Canon partner)'
def get(url):
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=40).read().decode('utf-8','replace')
    except Exception as e:
        return 'ERR '+str(e)
B='https://in.canon'
links=set()
for p in ['/en/consumer','/en/consumer/products','/en/business','/en/consumer/products/search?category=photography']:
    s=get(B+p)
    open('out/page_'+re.sub(r'\W','_',p)+'.html','w').write(s)
    for m in re.findall(r'(/en/(?:consumer|business)/products/search\?category=[^"\'<>\s]+)', s):
        links.add(html.unescape(m))
open('out/links.txt','w').write('\n'.join(sorted(links)))
lst={}
for l in sorted(links):
    m=re.search(r'/en/(\w+)/products/search\?category=([\w-]+)(?:&subCategory=([\w-]+))?', l)
    if not m or not m.group(3): continue
    sec,cat,sub=m.groups()
    if cat in ('printing','scanning'): continue
    items=[]; off=0
    for _ in range(30):
        s=get(f'{B}/en/{sec}/products/search/json?category={cat}&subCategory={sub}&max=30&offset={off}')
        try: d=json.loads(s)
        except Exception: items.append({'err':s[:200]}); break
        r=d.get('results') or []
        items+=r; off+=len(r)
        if not r or not d.get('hasMore'): break
        time.sleep(1)
    lst[f'{sec}|{cat}|{sub}']=items
json.dump(lst,open('out/listings.json','w'),indent=1)
# sample product pages
n=0
for k,items in lst.items():
    for it in items[:2]:
        if 'url' not in it: continue
        u=it['url']; u=u if u.startswith('http') else B+u.replace('/india/','/')
        s=get(u); n+=1
        open(f'out/prod_{n}_'+re.sub(r'\W','_',k)+'.html','w').write(s)
        time.sleep(1)
