# AIM Enterprises website

Website for AIM Enterprises, Canon partner in Sri Vijaya Puram (Port Blair), Andaman & Nicobar Islands.

Plain static site: open `index.html` in a browser, or host the folder on GitHub Pages or Netlify. Only online service booking needs the Netlify copy (see below).

## Updating products, prices or contact details

1. Edit `data/products.csv` (models, MRPs, descriptions) or `data/site.json` (phone, WhatsApp, email, address, featured models).
2. Run `python3 tools/build.py` from this folder.
3. Commit the regenerated pages.

Product MRPs were first taken from Canon India's website (in.canon) on 24 Oct 2026. Models with no MRP on Canon's site show "Price on request".

## Automatic sync with Canon India

Every morning at 06:00 IST the "Sync products with Canon India" GitHub workflow runs `tools/sync_canon.py`, then rebuilds and publishes the site. It:

- adds new printer, copier, scanner and plotter models that Canon India lists,
- updates each model's MRP (or "Price on request") from its Canon India page,
- downloads a model's photo again when Canon changes it,
- removes a model only when its Canon India page is gone and Canon no longer lists it.

Model names and descriptions you edit by hand are kept. If Canon's site is down or looks different, the run changes nothing. Each run's summary is on the Actions tab; `data/canon_sync.json` records the last check. To run it now: Actions, "Sync products with Canon India", Run workflow.

## How enquiries arrive

The quotation form opens WhatsApp (or the visitor's email app) with the details filled in, addressed to the number and email in `data/site.json`.

## Service booking and signed job closure

Works on GitHub Pages alone, with no server (`"service_api": ""` in `data/site.json`):

- **Customers** book on `service.html#book`. They get a job number, and WhatsApp opens with the booking addressed to the shop's number.
- **Engineers** open `engineer.html` (not linked from the site, hidden from search engines) on their phone at the customer's site, fill in the job sheet (job number from the WhatsApp booking, work done, parts, meter reading, charges), and the customer signs on the screen with a finger. The signed report can then be shared as an image (WhatsApp etc.), printed or saved as PDF, and a text summary sent to the customer and the office. The last 40 reports stay on that phone under "Reports on this phone".

Optional server mode: `netlify/functions/jobs.mjs` (Netlify Function + Netlify Blobs) adds a shared online job list and booking status check. It is used only when `service_api` lists a server address, or when the site itself runs on Netlify.
