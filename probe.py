import json, urllib.request, re, time
UA={'User-Agent':'Mozilla/5.0 (AIM Enterprises catalogue sync; Canon partner)'}
def get(u, data=None, h=None):
    hd=dict(UA); hd.update(h or {})
    return urllib.request.urlopen(urllib.request.Request(u,data=data,headers=hd),timeout=40).read().decode('utf-8','replace')
B='https://shop.in.canon'
# GraphQL
q='{categoryList(filters:{url_path:{eq:"ink-toner-paper"}}){id uid name children{uid name url_path product_count children{uid name url_path product_count}}}}'
try:
    print('GQL', get(B+'/graphql', json.dumps({'query':q}).encode(), {'Content-Type':'application/json'})[:3000])
except Exception as e: print('GQL ERR', e)
q2='{products(filter:{category_url_path:{eq:"ink-toner-paper/laser-consumables"}},pageSize:3){total_count items{sku name url_key __typename small_image{url} price_range{minimum_price{regular_price{value} final_price{value}}} }}}'
try:
    print('GQL2', get(B+'/graphql', json.dumps({'query':q2}).encode(), {'Content-Type':'application/json'})[:3000])
except Exception as e: print('GQL2 ERR', e)
for path in ('ink-toner-paper/laser-consumables','ink-toner-paper/inkjet-consumables','ink-toner-paper/paper-consumables'):
    p=get(f'{B}/{path}.html?product_list_limit=36')
    print('==',path,len(p))
    print('toolbar', re.findall(r'toolbar-number">([^<]+)<',p)[:4], re.findall(r'[?&]p=(\d+)',p)[-3:])
    items=re.findall(r'class="product-item-info"',p); print('items',len(items))
    i=p.find('product-item-info'); print(re.sub(r'\s+',' ',p[i:i+3500]))
    break
