import urllib.request, re
UA={'User-Agent':'Mozilla/5.0 (AIM Enterprises catalogue sync; Canon partner)'}
def get(u):
    r=urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=40); return r.status, r.read().decode('utf-8','replace')
s,p=get('https://shop.in.canon/gi-71-c-cyan.html'); print('SHOP',s,len(p),p[:300])
for u in ('https://in.canon/en/consumer/pixma-g3730/black/product','https://in.canon/en/consumer/imageclass-mf3010/main/product','https://in.canon/en/business/imagerunner-2425/main/product'):
    s,p=get(u); print('=====',u,s,len(p))
    for k in ('Related Consumables','Consumables','GI-71','Cartridge 925','NPG'):
        idx=[m.start() for m in re.finditer(re.escape(k),p)][:3]; print(k, idx)
    i=p.find('GI-71 C') if 'GI-71 C' in p else p.find('onsumable')
    print(p[max(0,i-3000):i+2500])
