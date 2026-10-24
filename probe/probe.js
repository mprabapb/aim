// Measures Canon India's live styling (fonts, colours, sizes) and saves screenshots.
const { chromium } = require('playwright');
const fs = require('fs');
const pages = {
  home: 'https://in.canon/en/consumer',
  category: 'https://in.canon/en/consumer/products/search?category=printing&subCategory=laser-printers',
  product: 'https://in.canon/en/consumer/pixma-g3010/main/product',
  business: 'https://in.canon/en/business/imagerunner-2425/main/product',
};
(async () => {
  const b = await chromium.launch();
  const out = {};
  for (const [name, url] of Object.entries(pages)) {
    for (const [vp, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
      const p = await b.newPage({ viewport: { width: w, height: h }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
      try {
        await p.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
      } catch (e) { out[name + '-' + vp] = { error: String(e) }; await p.close(); continue; }
      await p.waitForTimeout(2500);
      await p.screenshot({ path: `probe/shots/${name}-${vp}.png`, fullPage: vp === 'desk' });
      if (vp === 'phone') { await p.close(); continue; }
      out[name] = await p.evaluate(() => {
        const cs = (el) => { const s = getComputedStyle(el); return { tag: el.tagName, cls: String(el.className).slice(0, 80), text: (el.innerText || '').trim().slice(0, 40), font: s.fontFamily, size: s.fontSize, weight: s.fontWeight, lh: s.lineHeight, ls: s.letterSpacing, tt: s.textTransform, color: s.color, bg: s.backgroundColor, border: s.border, radius: s.borderRadius, pad: s.padding, h: el.getBoundingClientRect().height | 0 }; };
        const pick = (sel, n = 3) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).slice(0, n).map(cs);
        const byText = (re, n = 4) => [...document.querySelectorAll('a,button')].filter(e => e.offsetParent && re.test((e.innerText || '').trim())).slice(0, n).map(cs);
        const freq = (prop) => { const m = {}; document.querySelectorAll('body *').forEach(e => { if (!e.offsetParent) return; const v = getComputedStyle(e)[prop]; m[v] = (m[v] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 14); };
        const faces = []; for (const ss of document.styleSheets) { try { for (const r of ss.cssRules) if (r.constructor.name === 'CSSFontFaceRule') faces.push(r.cssText.slice(0, 300)); } catch (e) { faces.push('cross-origin: ' + ss.href); } }
        const vars = {}; for (const ss of document.styleSheets) { try { for (const r of ss.cssRules) if (r.selectorText === ':root') for (const q of r.style) if (q.startsWith('--')) vars[q] = r.style.getPropertyValue(q).trim(); } catch (e) {} }
        return {
          sheets: [...document.styleSheets].map(s => s.href).filter(Boolean),
          fontsLoaded: [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family} ${f.weight} ${f.style}`),
          faces: faces.slice(0, 30), rootVars: vars,
          body: cs(document.body), header: pick('header', 2), nav: pick('header nav a, header a', 14),
          h1: pick('h1'), h2: pick('h2', 4), h3: pick('h3', 4), p: pick('main p, p', 4),
          buttons: byText(/^(buy now|discover more|view products|read more|where to buy|view more|compare|load more|check)$/i, 8),
          price: [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /MRP/.test(e.textContent)).slice(0, 3).map(cs),
          footer: pick('footer', 1), footerLinks: pick('footer a', 4), footerHeads: pick('footer h2, footer h3, footer h4, footer strong', 4),
          colorFreq: freq('color'), bgFreq: freq('backgroundColor'), fontFreq: freq('fontFamily'), sizeFreq: freq('fontSize'),
        };
      });
      await p.close();
    }
  }
  fs.writeFileSync('probe/canon-style.json', JSON.stringify(out, null, 1));
  await b.close();
})();
