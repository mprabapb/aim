# AIM Enterprises website

Website for AIM Enterprises, Canon partner in Sri Vijaya Puram (Port Blair), Andaman & Nicobar Islands.

Plain static site: open `index.html` in a browser, or host the folder on GitHub Pages or Netlify. No server or database is needed.

## Updating products, prices or contact details

1. Edit `data/products.csv` (models, MRPs, descriptions) or `data/site.json` (phone, WhatsApp, email, address, featured models).
2. Run `python3 tools/build.py` from this folder.
3. Commit the regenerated pages.

Product MRPs were taken from Canon India's website (in.canon) on 24 Oct 2026. Models with no MRP on Canon's site show "Price on request".

## How enquiries arrive

The quotation and service forms open WhatsApp (or the visitor's email app) with the details filled in, addressed to the number and email in `data/site.json`.
