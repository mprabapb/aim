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

## Online service booking and signed job closure

- **Customers** book on `service.html#book` and get a job number (like `SR-261031-7KQ4`). They can check progress, and see the signed service report, under "Check Booking Status" with the job number and their phone.
- **Engineers** open `engineer.html` (not linked from the site, hidden from search engines), sign in with the staff PIN, assign a job, and close it on site: work done, parts, meter reading, charges, then the customer signs on the screen with a finger. The signed report can be printed or saved as PDF, or sent to the customer on WhatsApp.

Bookings are stored by a small Netlify Function (`netlify/functions/jobs.mjs`) in Netlify Blobs, so there is no database to run. To switch it on:

1. Deploy this branch on Netlify (Netlify installs `package.json` and picks up the function by itself).
2. In Netlify: Site configuration, Environment variables, add `STAFF_PIN` with the staff PIN, then redeploy. Share it only with engineers. After 5 wrong PINs from one address, sign-in there is locked for 15 minutes.

Where the booking server is not reachable (for example the GitHub Pages copy), "Book Service" opens WhatsApp with the details instead, so no booking is lost. To make GitHub Pages book online too, set `"service_api"` in `data/site.json` to the Netlify address (for example `"https://aim-enterprises.netlify.app"`) and run `python3 tools/build.py`.
