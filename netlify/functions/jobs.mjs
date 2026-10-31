// Service jobs API for the AIM website (Netlify Function + Netlify Blobs; no database to run).
//
// Public (customers):
//   POST /api/jobs                       book a service visit -> { id }
//   GET  /api/jobs/:id?phone=...         check a booking (phone must match)
// Staff (header "x-staff-pin" must equal the STAFF_PIN environment variable):
//   GET  /api/jobs                       list jobs, newest first
//   POST /api/jobs/:id/assign            { engineer, visitDate } -> status "Assigned"
//   POST /api/jobs/:id/close             { engineer, workDone, ..., signature } -> status "Closed"
//   POST /api/jobs/:id/cancel            { reason } -> status "Cancelled"
import { getStore } from '@netlify/blobs';

export const config = { path: ['/api/jobs', '/api/jobs/*'] };

// Swappable for tests
export const deps = {
  store: () => getStore({ name: 'service-jobs', consistency: 'strong' }),
  locks: () => getStore({ name: 'staff-signin-locks', consistency: 'strong' }),
  pin: () => process.env.STAFF_PIN || '',
};

// After MAX_FAILS wrong PINs from one address, staff sign-in is blocked there for LOCK_MS
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60e3;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-staff-pin',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
const fail = (msg, status = 400) => json({ error: msg }, status);

const clean = (v, max = 500) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// Job numbers like SR-261031-7KQ4: date first, so they sort by booking day
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newId() {
  const d = new Date(Date.now() + 5.5 * 3600e3); // IST
  const ymd = d.toISOString().slice(2, 10).replace(/-/g, '');
  let r = '';
  for (let i = 0; i < 4; i++) r += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return `SR-${ymd}-${r}`;
}

function sameText(a, b) {
  if (!a || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}

// What a customer may see about their own job
function publicView(j) {
  const v = { id: j.id, status: j.status, createdAt: j.createdAt, name: j.name, org: j.org, model: j.model, serial: j.serial,
    problem: j.problem, preferredDate: j.preferredDate, slot: j.slot, engineer: j.engineer, visitDate: j.visitDate };
  if (j.status === 'Closed') v.closure = j.closure;
  if (j.status === 'Cancelled') v.cancelReason = j.cancelReason;
  return v;
}

export default async function handler(req, context) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/jobs\/?/, '').split('/').filter(Boolean);
  const [id, action] = parts;
  const store = deps.store();

  const staffPin = deps.pin();
  const sentPin = req.headers.get('x-staff-pin') || '';
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  const lockKey = 'ip-' + ip.replace(/[^0-9a-fA-F:.]/g, '_');
  let staffOk = null;
  // Checks the PIN once per request, counting wrong tries per address
  const isStaff = async () => {
    if (staffOk !== null) return staffOk;
    if (!staffPin || !sentPin) return (staffOk = false);
    const locks = deps.locks();
    const now = Date.now();
    let rec = (await locks.get(lockKey, { type: 'json' })) || { fails: 0, since: now };
    if (now - rec.since > LOCK_MS) rec = { fails: 0, since: now };
    if (rec.fails >= MAX_FAILS) return (staffOk = 'locked');
    if (sameText(sentPin, staffPin)) {
      if (rec.fails) await locks.delete(lockKey);
      return (staffOk = true);
    }
    rec.fails += 1;
    await locks.setJSON(lockKey, rec);
    await new Promise((r) => setTimeout(r, 800));
    return (staffOk = false);
  };
  const needStaff = async () => {
    if (!staffPin) return fail('Engineer access is not set up yet: add STAFF_PIN in Netlify environment variables.', 503);
    const ok = await isStaff();
    if (ok === 'locked') return fail('Too many wrong PINs. Sign-in is locked for 15 minutes.', 429);
    if (!ok) return fail('Wrong PIN.', 401);
    return null;
  };

  // ---- Book a service (public) ----
  if (req.method === 'POST' && !id) {
    const b = await readBody(req);
    if (!b) return fail('Send the booking as JSON.');
    if (b.website) return json({ id: 'SR-OK' }); // honeypot field filled in by bots
    const job = {
      name: clean(b.name, 100), org: clean(b.org, 120), phone: clean(b.phone, 20), email: clean(b.email, 120),
      address: clean(b.address, 300), model: clean(b.model, 80), serial: clean(b.serial, 40), problem: clean(b.problem, 1000),
      preferredDate: clean(b.preferredDate, 10), slot: clean(b.slot, 20),
    };
    if (!job.name) return fail('Please enter your name.');
    if (digits(job.phone).length < 10) return fail('Please enter a 10 digit phone number.');
    if (!job.problem) return fail('Please describe the problem.');
    if (job.preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(job.preferredDate)) job.preferredDate = '';
    let jid = newId();
    for (let i = 0; i < 5 && (await store.get(jid)); i++) jid = newId();
    Object.assign(job, { id: jid, status: 'Booked', createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), status: 'Booked' }] });
    await store.setJSON(jid, job);
    return json({ id: jid, status: job.status }, 201);
  }

  // ---- Staff: list ----
  if (req.method === 'GET' && !id) {
    const denied = await needStaff();
    if (denied) return denied;
    const { blobs } = await store.list();
    const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 300);
    const jobs = (await Promise.all(keys.map((k) => store.get(k, { type: 'json' })))).filter(Boolean);
    // The list leaves out signatures to stay small; the close/detail call carries them
    return json({ jobs: jobs.map((j) => (j.closure ? { ...j, closure: { ...j.closure, signature: undefined, hasSignature: !!j.closure.signature } } : j)) });
  }

  if (!id || !/^SR-\d{6}-[A-Z0-9]{4}$/.test(id)) return fail('Not found.', 404);
  const job = await store.get(id, { type: 'json' });

  // ---- Check one job: customer with phone, or staff ----
  if (req.method === 'GET' && !action) {
    if (sentPin) {
      const denied = await needStaff();
      if (denied) return denied;
      return job ? json({ job }) : fail('Not found.', 404);
    }
    const phone = digits(url.searchParams.get('phone'));
    if (!job || phone.length < 10 || phone !== digits(job.phone)) {
      await new Promise((r) => setTimeout(r, 500));
      return fail('No booking matches that job number and phone.', 404);
    }
    return json({ job: publicView(job) });
  }

  if (req.method !== 'POST') return fail('Not found.', 404);
  const denied = await needStaff();
  if (denied) return denied;
  if (!job) return fail('Not found.', 404);
  const b = (await readBody(req)) || {};
  const now = new Date().toISOString();

  if (action === 'assign') {
    if (job.status === 'Closed') return fail('This job is already closed.', 409);
    job.engineer = clean(b.engineer, 60);
    job.visitDate = clean(b.visitDate, 10);
    if (!job.engineer) return fail('Enter the engineer name.');
    job.status = 'Assigned';
  } else if (action === 'close') {
    if (job.status === 'Closed') return fail('This job is already closed.', 409);
    const sig = String(b.signature || '');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > 400000) return fail('The customer signature is missing.');
    const c = {
      engineer: clean(b.engineer, 60), workDone: clean(b.workDone, 1500), parts: clean(b.parts, 500), meter: clean(b.meter, 30),
      charges: clean(b.charges, 20), payment: clean(b.payment, 30), remarks: clean(b.remarks, 500),
      signedBy: clean(b.signedBy, 80), rating: clean(b.rating, 2), closedAt: now, signature: sig,
    };
    if (!c.engineer) return fail('Enter the engineer name.');
    if (!c.workDone) return fail('Describe the work done.');
    if (!c.signedBy) return fail("Enter the customer's name under the signature.");
    job.engineer = c.engineer;
    job.closure = c;
    job.status = 'Closed';
  } else if (action === 'cancel') {
    if (job.status === 'Closed') return fail('This job is already closed.', 409);
    job.status = 'Cancelled';
    job.cancelReason = clean(b.reason, 300);
  } else {
    return fail('Not found.', 404);
  }
  job.history = [...(job.history || []), { at: now, status: job.status }];
  await store.setJSON(id, job);
  return json({ job });
}
