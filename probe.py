import re, subprocess, sys
sys.path.insert(0,'tools')
import sync_consumables as s
s.main()
p=s.fetch('https://in.canon/en/consumer/imageclass-mf3010/main/product')
i=p.find('consumablesPanel'); open('data/panel-sample.html','w').write(p[i-3000:i+12000])
