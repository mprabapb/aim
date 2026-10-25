import json, urllib.request, re, time
UA={'User-Agent':'Mozilla/5.0 (AIM Enterprises catalogue sync; Canon partner)'}
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=40).read().decode('utf-8','replace')
out={}
for sec in ('consumer','business'):
  for extra in ('', '&consumableType=INK', '&consumableType=TONER', '&consumableType=PAPER'):
    u=f'https://in.canon/en/{sec}/products/search/json?category=printing&subCategory=consumables&max=30&offset=0{extra}'
    try:
        d=json.loads(get(u)); res=d.get('results') or []
        print('==',sec,extra,'n=',len(res),'keys',list(d.keys()), 'total', {k:v for k,v in d.items() if k!='results'})
        if res: print(json.dumps(res[0])[:1500]); print([r.get('name') for r in res][:30])
    except Exception as e: print('ERR',u,e)
    time.sleep(1)
# one consumable page
d=json.loads(get('https://in.canon/en/consumer/products/search/json?category=printing&subCategory=consumables&max=30&offset=0'))
for r in (d.get('results') or [])[:2]:
    u=r['url']; u = u if u.startswith('http') else 'https://in.canon'+u
    p=get(u); print('PAGE',u,len(p))
    m=re.search(r'class="mastheadDetails__price[^"]*"(.{0,600})',p,re.S); print('PRICE',m and m.group(0)[:600])
    print('OG', re.findall(r'<meta[^>]+property="og:[^>]+>',p)[:6])
    for k in ('Yield','yield','Compatible','compatible'):
        i=p.find(k); print(k, re.sub(r'\s+',' ',re.sub('<[^>]+>',' ',p[i-200:i+800])) if i>0 else None)
