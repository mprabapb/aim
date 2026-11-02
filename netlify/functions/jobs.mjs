// Service jobs API for the AIM website (Netlify Function + Netlify Blobs; no database to run).
//
// Public (customers):
//   POST /api/jobs                       book a service visit -> { id }
//   GET  /api/jobs/:id?phone=...         check a booking (phone must match)
// Staff log in with their own username and password; the token they get back goes in the JSON body
// as _token. Each staff route needs its menu permission (service, attendance, register, admin):
//   GET  /api/jobs/auth/ping             { auth: 2, setup } setup is true while no login exists yet
//   POST /api/jobs/auth/setup            { name, username, password, pin } first (owner) login; pin = old staff PIN if one was set
//   POST /api/jobs/auth/login            { username, password } -> { token, user }
//   POST /api/jobs/auth/me | logout | password { oldPassword, newPassword }
//   POST /api/jobs/auth/users            (admin) list logins
//   POST /api/jobs/auth/usersave         (admin) { username, name, perms[], active, password, isNew }
//   POST /api/jobs/auth/userdel          (admin) { username }
//   GET  /api/jobs                       (service) list jobs, newest first
//   POST /api/jobs/:id/assign            (service) { engineer, visitDate } -> status "Assigned"
//   POST /api/jobs/:id/close             (service) { engineer, workDone, ..., signature } -> status "Closed"
//   POST /api/jobs/:id/cancel            (service) { reason } -> status "Cancelled"
//   POST /api/jobs/attendance            (attendance) { op: "in"|"out", lat, lng, acc } check-in / check-out (server time)
//                                        (register) { op: "mark", engineer, date, mark, inTime, outTime, note } office mark for a day
//   GET  /api/jobs/attendance            { month: "yyyy-MM" } (staff POST with _get) -> { entries } (own only without register)
import { getStore } from '@netlify/blobs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const config = { path: ['/api/jobs', '/api/jobs/*'] };

// Swappable for tests
export const deps = {
  store: () => getStore({ name: 'service-jobs', consistency: 'strong' }),
  attendance: () => getStore({ name: 'engineer-attendance', consistency: 'strong' }),
  locks: () => getStore({ name: 'staff-signin-locks', consistency: 'strong' }),
  pin: () => process.env.STAFF_PIN || '',
};

// After MAX_FAILS wrong passwords for one login, that login is blocked for LOCK_MS
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60e3;
const SESSION_MS = 12 * 3600e3;
const PIN_KEY = 'config-staff-pin';   // the old shared staff PIN (before staff logins)
const USERS_KEY = 'config-users';
const PERMS = ['service', 'attendance', 'register', 'admin'];
// Spam guard: at most 3 bookings a day from one phone number and 100 a day in total
const MAX_PER_PHONE = 3;
const MAX_PER_DAY = 100;
// A strong password: 8 to 64 characters, no spaces, with at least one letter and one number
const pwOk = (pw) => /^\S{8,64}$/.test(pw) && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
const PW_RULE = 'Use at least 8 characters with letters and numbers, and no spaces.';
const hashPin = (pin, salt) => scryptSync(String(pin), Buffer.from(salt, 'hex'), 32).toString('hex');
const hashMatches = (pw, salt, hash) => {
  const a = Buffer.from(hashPin(pw, salt), 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
};
const setPassword = (rec, pw) => { rec.salt = randomBytes(16).toString('hex'); rec.hash = hashPin(pw, rec.salt); rec.ver = (rec.ver || 0) + 1; };
const userName = (v) => String(v || '').trim().toLowerCase();
const nameOk = (u) => /^[a-z0-9._-]{3,30}$/.test(u);
const publicUser = (id, r) => ({ username: id, name: r.name, perms: r.perms, active: r.active !== false, createdAt: r.createdAt || '', lastLogin: r.lastLogin || '' });
const readUsers = async () => (await deps.locks().get(USERS_KEY, { type: 'json' })) || {};
const saveUsers = (u) => deps.locks().setJSON(USERS_KEY, u);
async function newSession(id, rec) {
  const token = randomBytes(32).toString('hex');
  await deps.locks().setJSON('sess-' + token, { u: id, v: rec.ver, exp: Date.now() + SESSION_MS });
  return token;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
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
  // Pages on another address (aimenterprises.net) send "simple" requests to avoid CORS preflights:
  // the login token travels in the JSON body as _token, and a staff read is a POST with _get: true.
  const body = req.method === 'POST' ? await readBody(req) : null;
  const method = req.method === 'POST' && body && body._get === true ? 'GET' : req.method;
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/jobs\/?/, '').split('/').filter(Boolean);
  const [id, action] = parts;
  const store = deps.store();

  const locks = deps.locks();
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Wrong-password counter for one key (a login name, or the old PIN at set-up)
  const tooMany = async (key) => {
    const rec = await locks.get(key, { type: 'json' });
    return rec && Date.now() - rec.since <= LOCK_MS && rec.fails >= MAX_FAILS;
  };
  const countFail = async (key) => {
    let rec = (await locks.get(key, { type: 'json' })) || { fails: 0, since: Date.now() };
    if (Date.now() - rec.since > LOCK_MS) rec = { fails: 0, since: Date.now() };
    rec.fails += 1;
    await locks.setJSON(key, rec);
    await wait(800);
  };
  // The signed-in person for this request, or null. A password reset, a menu change or a disabled
  // login ends that person's old sessions at once (the version number no longer matches).
  const token = body && typeof body._token === 'string' && /^[a-f0-9]{64}$/.test(body._token) ? body._token : '';
  let me;
  const session = async () => {
    if (me !== undefined) return me;
    me = null;
    if (!token) return me;
    const s = await locks.get('sess-' + token, { type: 'json' });
    if (!s || s.exp < Date.now()) return me;
    const rec = (await readUsers())[s.u];
    if (!rec || rec.active === false || rec.ver !== s.v) { await locks.delete('sess-' + token); return me; }
    if (s.exp - Date.now() < SESSION_MS / 2) await locks.setJSON('sess-' + token, { ...s, exp: Date.now() + SESSION_MS });
    me = { id: s.u, rec, can: (p) => rec.perms.includes(p) || rec.perms.includes('admin') };
    return me;
  };
  // null when allowed, otherwise the error reply
  const need = async (...perms) => {
    const s = await session();
    if (!s) return fail('Please sign in again.', 401);
    if (perms.length && !perms.some((p) => s.can(p))) return fail('You do not have permission for this. Ask the owner.', 403);
    return null;
  };

  // ---- Staff logins ----
  if (id === 'auth') {
    const b = body || {};
    if (action === 'ping') {
      const none = !Object.keys(await readUsers()).length;
      const oldPin = deps.pin() || (await locks.get(PIN_KEY, { type: 'json' }));
      return json({ ok: true, auth: 2, setup: none, needPin: none && !!oldPin });
    }
    if (req.method !== 'POST') return fail('Not found.', 404);
    if (action === 'setup') {
      // First login only, while nobody has one: becomes the owner with every menu.
      // If the old shared staff PIN is set, it must be given, so a stranger cannot claim the owner login.
      const all = await readUsers();
      if (Object.keys(all).length) return fail('The owner login already exists. Please sign in.', 409);
      const envPin = deps.pin(), saved = envPin ? null : await locks.get(PIN_KEY, { type: 'json' });
      if (envPin || (saved && saved.hash)) {
        const key = 'fail-setup-' + ip.replace(/[^0-9a-fA-F:.]/g, '_');
        if (await tooMany(key)) return fail('Too many wrong PINs. Try again in 15 minutes.', 429);
        const p = String(b.pin || '');
        const ok = envPin ? sameText(p, envPin) : hashMatches(p, saved.salt, saved.hash);
        if (!ok) { await countFail(key); return fail('The old staff PIN is wrong.', 401); }
      }
      const u = userName(b.username);
      if (!nameOk(u)) return fail('Username: 3 to 30 letters or numbers (no spaces).');
      if (!pwOk(String(b.password || ''))) return fail(PW_RULE);
      const rec = { name: clean(b.name, 60) || u, perms: [...PERMS], active: true, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() };
      setPassword(rec, String(b.password));
      all[u] = rec;
      await saveUsers(all);
      if (saved) await locks.delete(PIN_KEY);
      return json({ token: await newSession(u, rec), user: publicUser(u, rec) }, 201);
    }
    if (action === 'login') {
      const u = userName(b.username);
      const key = 'fail-' + u.replace(/[^a-z0-9._-]/g, '').slice(0, 30);
      if (await tooMany(key)) return fail('Too many wrong passwords for this login. Try again in 15 minutes.', 429);
      const all = await readUsers(), rec = all[u];
      if (!rec || rec.active === false || !hashMatches(String(b.password || ''), rec.salt, rec.hash)) {
        await countFail(key);
        return fail('Wrong username or password.', 401);
      }
      await locks.delete(key);
      rec.lastLogin = new Date().toISOString();
      await saveUsers(all);
      return json({ token: await newSession(u, rec), user: publicUser(u, rec) });
    }
    const denied = await need();
    if (denied) return denied;
    if (action === 'me') return json({ user: publicUser(me.id, me.rec) });
    if (action === 'logout') { await locks.delete('sess-' + token); return json({ ok: true }); }
    if (action === 'password') {
      if (!hashMatches(String(b.oldPassword || ''), me.rec.salt, me.rec.hash)) { await wait(800); return fail('Your current password is wrong.', 400); }
      if (!pwOk(String(b.newPassword || ''))) return fail(PW_RULE);
      const all = await readUsers();
      setPassword(all[me.id], String(b.newPassword));
      await saveUsers(all);
      return json({ token: await newSession(me.id, all[me.id]), user: publicUser(me.id, all[me.id]) });
    }
    if (!me.can('admin')) return fail('You do not have permission for this. Ask the owner.', 403);
    const all = await readUsers();
    const list = () => Object.keys(all).sort().map((k) => publicUser(k, all[k]));
    if (action === 'users') return json({ users: list() });
    const u = userName(b.username);
    if (action === 'userdel') {
      if (!all[u]) return fail('No such login.', 404);
      if (u === me.id) return fail('You cannot delete your own login.', 409);
      delete all[u];
    } else if (action === 'usersave') {
      // Add a person, or change their name, menus, active / disabled, or set a new password
      if (!nameOk(u)) return fail('Username: 3 to 30 letters or numbers (no spaces).');
      let rec = all[u];
      if (b.isNew && rec) return fail('That username is taken. Pick another.', 409);
      const perms = PERMS.filter((p) => Array.isArray(b.perms) && b.perms.includes(p)), pw = String(b.password || '');
      if (!perms.length) return fail('Tick at least one menu.');
      if (!rec) { if (!pwOk(pw)) return fail('Password: ' + PW_RULE); rec = { createdAt: new Date().toISOString() }; }
      else if (pw && !pwOk(pw)) return fail('Password: ' + PW_RULE);
      if (u === me.id && (!perms.includes('admin') || b.active === false)) return fail('You cannot remove your own Staff Logins menu or disable yourself.', 409);
      const changed = !rec.perms || rec.perms.join() !== perms.join() || (rec.active !== false) !== (b.active !== false);
      rec.name = clean(b.name, 60) || u; rec.perms = perms; rec.active = b.active !== false;
      if (pw) setPassword(rec, pw); else if (changed) rec.ver = (rec.ver || 0) + 1;
      all[u] = rec;
    } else return fail('Not found.', 404);
    if (!Object.values(all).some((r) => r.active !== false && r.perms.includes('admin'))) return fail('Keep at least one owner login with Staff Logins.', 409);
    await saveUsers(all);
    const mine = all[me.id];
    return json({ users: list(), token: mine && mine.ver !== me.rec.ver ? await newSession(me.id, mine) : undefined });
  }

  // ---- Book a service (public) ----
  if (method === 'POST' && !id) {
    const b = body;
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
    const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const counts = (await deps.locks().get('book-' + day, { type: 'json' })) || { total: 0, phones: {} };
    const ph = digits(job.phone);
    if ((counts.phones[ph] || 0) >= MAX_PER_PHONE) return fail(`This phone number already has ${MAX_PER_PHONE} bookings today. Please call or WhatsApp us.`, 429);
    if (counts.total >= MAX_PER_DAY) return fail('Online booking is busy today. Please call or WhatsApp us.', 429);
    counts.total += 1; counts.phones[ph] = (counts.phones[ph] || 0) + 1;
    await deps.locks().setJSON('book-' + day, counts);
    let jid = newId();
    for (let i = 0; i < 5 && (await store.get(jid)); i++) jid = newId();
    Object.assign(job, { id: jid, status: 'Booked', createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), status: 'Booked' }] });
    await store.setJSON(jid, job);
    return json({ id: jid, status: job.status }, 201);
  }

  // ---- Staff: list ----
  if (method === 'GET' && !id) {
    const denied = await need('service');
    if (denied) return denied;
    const { blobs } = await store.list();
    const keys = blobs.map((b) => b.key).sort().reverse().slice(0, 300);
    const jobs = (await Promise.all(keys.map((k) => store.get(k, { type: 'json' })))).filter(Boolean);
    // The list leaves out signatures to stay small; the close/detail call carries them
    return json({ jobs: jobs.map((j) => (j.closure ? { ...j, closure: { ...j.closure, signature: undefined, hasSignature: !!j.closure.signature } } : j)) });
  }

  // ---- Engineer attendance (staff only) ----
  if (id === 'attendance') {
    const b = body || {};
    const denied = await need(...(method === 'POST' && b.op === 'mark' ? ['register'] : ['attendance', 'register']));
    if (denied) return denied;
    // Without the register menu, staff see and check in only themselves
    const own = me.can('register') ? '' : me.rec.name;
    if (own) b.engineer = own;
    const att = deps.attendance();
    if (method === 'GET') {
      let month = clean(b.month || url.searchParams.get('month'), 7);
      if (!/^\d{4}-\d{2}$/.test(month)) month = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
      const { blobs } = await att.list({ prefix: month + '/' });
      const entries = (await Promise.all(blobs.map((x) => att.get(x.key, { type: 'json' })))).filter(Boolean);
      entries.sort((x, y) => (x.at < y.at ? -1 : 1));
      return json({ month, entries: own ? entries.filter((e) => String(e.engineer).toLowerCase() === own.toLowerCase()) : entries });
    }
    if (method !== 'POST') return fail('Not found.', 404);
    const now = new Date();
    const a = { id: randomBytes(4).toString('hex'), at: now.toISOString(), engineer: clean(b.engineer, 60).replace(/\s+/g, ' '),
      note: clean(b.note, 200), inTime: '', outTime: '', lat: '', lng: '', acc: '' };
    if (!a.engineer) return fail('Pick your name first.');
    if (b.op === 'in' || b.op === 'out') {
      a.kind = b.op === 'in' ? 'In' : 'Out';
      a.by = 'phone';
      a.date = new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
      const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.acc);
      if (b.lat !== '' && b.lat != null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        a.lat = lat.toFixed(6); a.lng = lng.toFixed(6); a.acc = Number.isFinite(acc) ? String(Math.round(acc)) : '';
      }
    } else if (b.op === 'mark') {
      a.kind = clean(b.mark, 20);
      a.by = 'office';
      a.date = clean(b.date, 10);
      if (!['Present', 'Half day', 'Leave', 'Absent', 'Holiday'].includes(a.kind)) return fail('Pick Present, Half day, Leave, Absent or Holiday.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return fail('Pick the date.');
      const t = /^([01]\d|2[0-3]):[0-5]\d$/;
      a.inTime = t.test(String(b.inTime || '')) ? String(b.inTime) : '';
      a.outTime = t.test(String(b.outTime || '')) ? String(b.outTime) : '';
    } else return fail('Not found.', 404);
    await att.setJSON(`${a.date.slice(0, 7)}/${a.date}-${now.getTime()}-${a.id}`, a);
    return json({ entry: a }, 201);
  }

  if (!id || !/^SR-\d{6}-[A-Z0-9]{4}$/.test(id)) return fail('Not found.', 404);
  const job = await store.get(id, { type: 'json' });

  // ---- Check one job: customer with phone, or staff ----
  if (method === 'GET' && !action) {
    if (token) {
      const denied = await need('service');
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

  if (method !== 'POST') return fail('Not found.', 404);
  const denied = await need('service');
  if (denied) return denied;
  if (!job) return fail('Not found.', 404);
  const b = body || {};
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
  job.history = [...(job.history || []), { at: now, status: job.status, by: me.id }];
  await store.setJSON(id, job);
  return json({ job });
}
