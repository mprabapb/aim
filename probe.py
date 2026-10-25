import sys, os, re
sys.path.insert(0,'.')
import sync_consumables as s
s.ROOT='.'; s.OUT='data/consumables.csv'
s.main()
print(open('data/consumables.csv').read())
p=s.fetch('https://in.canon/en/consumer/imageclass-mf3010/main/product')
i=p.find('consumablesPanel'); print(re.sub(r'\n\s*\n+','\n',p[i-1500:i+6000]))
