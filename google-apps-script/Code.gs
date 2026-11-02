/**
 * AIM Enterprises service jobs server (Google Apps Script + Google Sheet). Free, no Netlify.
 *
 * Set-up (once): script.google.com > New project > paste this file > Deploy > New deployment >
 * type "Web app", Execute as "Me", Who has access "Anyone" > Deploy > allow access >
 * copy the Web app URL into "service_api" in data/site.json.
 *
 * It creates a Google Sheet "AIM Service Jobs" (one row per job) and a Drive folder
 * "AIM Service Signatures" (one PNG per signed job) in the owner's Google account.
 *
 * Staff logins: each person signs in on the Engineer page with their own username and password.
 * The first login made becomes the owner (all menus); the owner adds the others under "Staff Logins"
 * and ticks the menus each may use: Service Jobs, My Attendance, Attendance Register, Staff Logins.
 * If the owner password is lost: Project settings > Script properties > delete USERS, then create the
 * owner login again on the Engineer page (all other logins must then be added again).
 *
 * Engineer attendance is kept in a second tab "Attendance" of the same Sheet (one row per check-in,
 * check-out or office mark). Staff actions: attend {op: in|out|mark, ...} and attlist {month: yyyy-MM}.
 *
 * Every call is a GET (?action=...) or a POST with a JSON body {action, ...}; the reply is JSON
 * with "status" (HTTP-like code) and either the data or "error".
 */
var COLS = ['id', 'status', 'createdAt', 'name', 'org', 'phone', 'email', 'address', 'model', 'serial', 'problem',
  'preferredDate', 'slot', 'engineer', 'visitDate', 'cancelReason', 'closedAt', 'workDone', 'parts', 'meter',
  'charges', 'payment', 'remarks', 'signedBy', 'signatureFile', 'history'];
// Spam guard: at most 3 bookings a day from one phone number and 100 a day in total
var MAX_PER_PHONE = 3, MAX_PER_DAY = 100;
var ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function doGet(e) { return handle_(e.parameter || {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ status: 400, error: 'Send JSON.' }); }
  return handle_(body);
}

function out_(o) {
  if (!o.status) o.status = 200;
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(msg, status) { return out_({ status: status || 400, error: msg }); }
function clean_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max || 500); }
function digits_(p) { return String(p || '').replace(/\D/g, '').slice(-10); }
function props_() { return PropertiesService.getScriptProperties(); }

function sheet_() {
  var p = props_(), id = p.getProperty('SHEET_ID'), ss;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('AIM Service Jobs');
    p.setProperty('SHEET_ID', ss.getId());
    var sh = ss.getSheets()[0];
    sh.setName('Jobs');
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return ss.getSheetByName('Jobs') || ss.getSheets()[0];
}
var ATT_COLS = ['id', 'at', 'date', 'engineer', 'kind', 'inTime', 'outTime', 'lat', 'lng', 'acc', 'note', 'by'];
var ATT_MARKS = ['Present', 'Half day', 'Leave', 'Absent', 'Holiday'];
function attSheet_() {
  var ss = sheet_().getParent(), sh = ss.getSheetByName('Attendance');
  if (!sh) {
    sh = ss.insertSheet('Attendance');
    sh.getRange(1, 1, 1, ATT_COLS.length).setValues([ATT_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function attRow_(r) {
  var a = {};
  ATT_COLS.forEach(function (c, i) { a[c] = r[i] instanceof Date ? r[i].toISOString() : String(r[i] == null ? '' : r[i]); });
  return a;
}
// One check-in / check-out from the engineer's phone (time is the server's, in IST), or an office mark for a day
function attend_(b) {
  var op = String(b.op || ''), now = new Date();
  var a = { id: Utilities.getUuid().slice(0, 8), at: now.toISOString(), engineer: clean_(b.engineer, 60).replace(/\s+/g, ' '),
    note: clean_(b.note, 200), inTime: '', outTime: '', lat: '', lng: '', acc: '' };
  if (!a.engineer) return fail_('Pick your name first.');
  if (op === 'in' || op === 'out') {
    a.kind = op === 'in' ? 'In' : 'Out'; a.by = 'phone';
    a.date = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
    var lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.acc);
    if (b.lat !== '' && b.lat != null && isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      a.lat = lat.toFixed(6); a.lng = lng.toFixed(6); a.acc = isFinite(acc) ? String(Math.round(acc)) : '';
    }
  } else if (op === 'mark') {
    a.kind = clean_(b.mark, 20); a.by = 'office'; a.date = clean_(b.date, 10);
    if (ATT_MARKS.indexOf(a.kind) < 0) return fail_('Pick Present, Half day, Leave, Absent or Holiday.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return fail_('Pick the date.');
    var t = /^([01]\d|2[0-3]):[0-5]\d$/;
    a.inTime = t.test(String(b.inTime || '')) ? String(b.inTime) : '';
    a.outTime = t.test(String(b.outTime || '')) ? String(b.outTime) : '';
  } else return fail_('Not found.', 404);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    attSheet_().appendRow(ATT_COLS.map(function (c) { var v = a[c] == null ? '' : String(a[c]); return v === '' ? '' : "'" + v; }));
  } finally { lock.releaseLock(); }
  return out_({ status: 201, entry: a });
}
function attList_(b, only) {
  var month = clean_(b.month, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) month = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM');
  var sh = attSheet_(), last = sh.getLastRow();
  if (last < 2) return out_({ month: month, entries: [] });
  var rows = sh.getRange(2, 1, last - 1, ATT_COLS.length).getValues();
  var mine = function (a) { return !only || a.engineer.toLowerCase() === String(only).toLowerCase(); };
  return out_({ month: month, entries: rows.map(attRow_).filter(function (a) { return a.id && a.date.slice(0, 7) === month && mine(a); }) });
}
function folder_() {
  var p = props_(), id = p.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('AIM Service Signatures');
  p.setProperty('FOLDER_ID', f.getId());
  return f;
}
function rowToJob_(row) {
  var j = {};
  COLS.forEach(function (c, i) { j[c] = row[i] instanceof Date ? row[i].toISOString() : String(row[i] == null ? '' : row[i]); });
  try { j.history = JSON.parse(j.history || '[]'); } catch (e) { j.history = []; }
  if (j.status === 'Closed') {
    j.closure = { engineer: j.engineer, workDone: j.workDone, parts: j.parts, meter: j.meter, charges: j.charges, payment: j.payment,
      remarks: j.remarks, signedBy: j.signedBy, closedAt: j.closedAt, hasSignature: !!j.signatureFile };
  }
  return j;
}
// Every cell is written with a leading ' so the Sheet keeps it as plain text (no number, date or formula guessing)
function jobToRow_(j) {
  return COLS.map(function (c) {
    var v = c === 'history' ? JSON.stringify(j.history || []) : (j[c] == null ? '' : String(j[c]));
    return v === '' ? '' : "'" + v;
  });
}
function find_(sh, id) {
  var cell = sh.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
  if (!cell) return null;
  var r = cell.getRow();
  return { row: r, job: rowToJob_(sh.getRange(r, 1, 1, COLS.length).getValues()[0]) };
}
function withSignature_(j) {
  if (j.closure && j.signatureFile) {
    try { j.closure.signature = 'data:image/png;base64,' + Utilities.base64Encode(DriveApp.getFileById(j.signatureFile).getBlob().getBytes()); } catch (e) {}
  }
  return j;
}
function publicView_(j) {
  var v = { id: j.id, status: j.status, createdAt: j.createdAt, name: j.name, org: j.org, model: j.model, serial: j.serial, problem: j.problem,
    preferredDate: j.preferredDate, slot: j.slot, engineer: j.engineer, visitDate: j.visitDate };
  if (j.status === 'Closed') v.closure = j.closure;
  if (j.status === 'Cancelled') v.cancelReason = j.cancelReason;
  return v;
}
function newId_(sh) {
  var ymd = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyMMdd');
  for (var t = 0; t < 6; t++) {
    var r = '';
    for (var k = 0; k < 4; k++) r += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    var id = 'SR-' + ymd + '-' + r;
    if (!find_(sh, id)) return id;
  }
  return 'SR-' + ymd + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
}
// ---------- Staff logins ----------
// Each person has their own username and password (kept only as a salted hash) and a list of the
// menus they may use. The owner ("Staff Logins" permission) adds people and ticks their menus.
// Every staff call is checked here on the server, so hiding a menu on the page is not the only guard.
var PERMS = ['service', 'attendance', 'register', 'admin'];
var PW_RULE = 'Use at least 8 characters with letters and numbers, and no spaces.';
var MAX_FAILS = 5, LOCK_SECONDS = 900, SESSION_SECONDS = 21600, HASH_ROUNDS = 300;
function pwOk_(pw) { return /^\S{8,64}$/.test(pw) && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw); }
function hash_(pw, salt) {
  var h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pw, Utilities.Charset.UTF_8);
  for (var i = 0; i < HASH_ROUNDS; i++) h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h.concat(Utilities.newBlob(salt).getBytes()));
  return Utilities.base64Encode(h);
}
function users_() { try { return JSON.parse(props_().getProperty('USERS') || '{}'); } catch (e) { return {}; } }
function saveUsers_(u) { props_().setProperty('USERS', JSON.stringify(u)); }
function userName_(v) { return String(v || '').trim().toLowerCase(); }
function nameOk_(u) { return /^[a-z0-9._-]{3,30}$/.test(u); }
function cleanPerms_(list) { return PERMS.filter(function (p) { return (list || []).indexOf(p) >= 0; }); }
function setPassword_(rec, pw) { rec.salt = Utilities.getUuid(); rec.hash = hash_(pw, rec.salt); rec.ver = (rec.ver || 0) + 1; }
function publicUser_(id, r) { return { username: id, name: r.name, perms: r.perms, active: r.active !== false, createdAt: r.createdAt || '', lastLogin: r.lastLogin || '' }; }
function newSession_(id, rec) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess-' + token, JSON.stringify({ u: id, v: rec.ver }), SESSION_SECONDS);
  return token;
}
// The signed-in person for this call, or null. A password reset, a menu change or a disabled
// login ends that person's old sessions at once (the version number no longer matches).
function session_(b) {
  var token = String(b._token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  var cache = CacheService.getScriptCache(), raw = cache.get('sess-' + token), s;
  if (!raw) return null;
  try { s = JSON.parse(raw); } catch (e) { return null; }
  var rec = users_()[s.u];
  if (!rec || rec.active === false || rec.ver !== s.v) { cache.remove('sess-' + token); return null; }
  cache.put('sess-' + token, raw, SESSION_SECONDS);  // stays signed in while in use
  return { id: s.u, rec: rec, token: token, can: function (p) { return rec.perms.indexOf(p) >= 0 || rec.perms.indexOf('admin') >= 0; } };
}
function denied_() { return fail_('You do not have permission for this. Ask the owner.', 403); }

// Login and account actions; returns null when the action is not one of these
function authAction_(action, b) {
  var cache = CacheService.getScriptCache(), lock, u, rec;
  if (action === 'authping') {
    var none = !Object.keys(users_()).length;
    return out_({ ok: true, auth: 2, setup: none, needPin: none && !!props_().getProperty('PIN_HASH') });
  }
  if (action === 'setup') {
    // First login only, while nobody has one: becomes the owner with every menu.
    // If the old shared staff PIN is set, it must be given, so a stranger cannot claim the owner login.
    lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var all = users_();
      if (Object.keys(all).length) return fail_('The owner login already exists. Please sign in.', 409);
      var oldHash = props_().getProperty('PIN_HASH');
      if (oldHash) {
        var tries = Number(cache.get('setup-fails') || 0);
        if (tries >= MAX_FAILS) return fail_('Too many wrong PINs. Try again in 15 minutes.', 429);
        if (oldPinHash_(String(b.pin || ''), props_().getProperty('PIN_SALT')) !== oldHash) {
          cache.put('setup-fails', String(tries + 1), LOCK_SECONDS); Utilities.sleep(800);
          return fail_('The old staff PIN is wrong.', 401);
        }
      }
      u = userName_(b.username);
      if (!nameOk_(u)) return fail_('Username: 3 to 30 letters or numbers (no spaces).');
      if (!pwOk_(String(b.password || ''))) return fail_(PW_RULE);
      rec = { name: clean_(b.name, 60) || u, perms: PERMS.slice(), active: true, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString() };
      setPassword_(rec, String(b.password));
      all[u] = rec; saveUsers_(all);
      props_().deleteProperty('PIN_HASH'); props_().deleteProperty('PIN_SALT');  // the shared PIN stops working
      return out_({ status: 201, token: newSession_(u, rec), user: publicUser_(u, rec) });
    } finally { lock.releaseLock(); }
  }
  if (action === 'login') {
    u = userName_(b.username);
    var key = 'fail-' + u.replace(/[^a-z0-9._-]/g, '').slice(0, 30), bad = false;
    lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var n = Number(cache.get(key) || 0);
      if (n >= MAX_FAILS) return fail_('Too many wrong passwords for this login. Try again in 15 minutes.', 429);
      rec = users_()[u];
      if (!rec || rec.active === false || hash_(String(b.password || ''), rec.salt) !== rec.hash) { cache.put(key, String(n + 1), LOCK_SECONDS); bad = true; }
      else cache.remove(key);
    } finally { lock.releaseLock(); }
    if (bad) { Utilities.sleep(800); return fail_('Wrong username or password.', 401); }
    lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { var all2 = users_(); if (all2[u]) { all2[u].lastLogin = new Date().toISOString(); saveUsers_(all2); } } finally { lock.releaseLock(); }
    return out_({ token: newSession_(u, rec), user: publicUser_(u, rec) });
  }
  if (['me', 'logout', 'password', 'users', 'usersave', 'userdel'].indexOf(action) < 0) return null;
  var s = session_(b);
  if (!s) return fail_('Please sign in again.', 401);
  if (action === 'me') return out_({ user: publicUser_(s.id, s.rec) });
  if (action === 'logout') { cache.remove('sess-' + s.token); return out_({ ok: true }); }
  if (action === 'password') {
    if (hash_(String(b.oldPassword || ''), s.rec.salt) !== s.rec.hash) { Utilities.sleep(800); return fail_('Your current password is wrong.', 400); }
    if (!pwOk_(String(b.newPassword || ''))) return fail_(PW_RULE);
    lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { var a3 = users_(); setPassword_(a3[s.id], String(b.newPassword)); saveUsers_(a3); return out_({ token: newSession_(s.id, a3[s.id]), user: publicUser_(s.id, a3[s.id]) }); }
    finally { lock.releaseLock(); }
  }
  if (!s.can('admin')) return denied_();
  if (action === 'users') {
    var list = users_();
    return out_({ users: Object.keys(list).sort().map(function (k) { return publicUser_(k, list[k]); }) });
  }
  lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var all4 = users_(); u = userName_(b.username);
    if (action === 'userdel') {
      if (!all4[u]) return fail_('No such login.', 404);
      if (u === s.id) return fail_('You cannot delete your own login.', 409);
      delete all4[u];
    } else {
      // Add a person, or change their name, menus, active / disabled, or set a new password
      if (!nameOk_(u)) return fail_('Username: 3 to 30 letters or numbers (no spaces).');
      rec = all4[u];
      if (b.isNew && rec) return fail_('That username is taken. Pick another.', 409);
      var perms = cleanPerms_(b.perms), pw = String(b.password || '');
      if (!perms.length) return fail_('Tick at least one menu.');
      if (!rec) { if (!pwOk_(pw)) return fail_('Password: ' + PW_RULE); rec = { createdAt: new Date().toISOString() }; }
      else if (pw && !pwOk_(pw)) return fail_('Password: ' + PW_RULE);
      if (u === s.id && (perms.indexOf('admin') < 0 || b.active === false)) return fail_('You cannot remove your own Staff Logins menu or disable yourself.', 409);
      var changed = !rec.perms || rec.perms.join() !== perms.join() || (rec.active !== false) !== (b.active !== false);
      rec.name = clean_(b.name, 60) || u; rec.perms = perms; rec.active = b.active !== false;
      if (pw) setPassword_(rec, pw); else if (changed) rec.ver = (rec.ver || 0) + 1;
      all4[u] = rec;
    }
    if (!Object.keys(all4).some(function (k) { return all4[k].active !== false && all4[k].perms.indexOf('admin') >= 0; })) return fail_('Keep at least one owner login with Staff Logins.', 409);
    saveUsers_(all4);
    var keepMe = all4[s.id];
    return out_({ users: Object.keys(all4).sort().map(function (k) { return publicUser_(k, all4[k]); }),
      token: keepMe && keepMe.ver !== s.rec.ver ? newSession_(s.id, keepMe) : undefined });
  } finally { lock.releaseLock(); }
}
// The old shared staff PIN (before staff logins) was stored as one SHA-256 of salt:pin
function oldPinHash_(pin, salt) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8));
}

function handle_(b) {
  var action = String(b.action || '');
  try {
    if (action === 'ping') action = 'authping';
    var authRes = authAction_(action, b);
    if (authRes) return authRes;

    if (action === 'book') {
      if (b.website) return out_({ id: 'SR-OK' });
      var job = { name: clean_(b.name, 100), org: clean_(b.org, 120), phone: clean_(b.phone, 20), email: clean_(b.email, 120), address: clean_(b.address, 300),
        model: clean_(b.model, 80), serial: clean_(b.serial, 40), problem: clean_(b.problem, 1000), preferredDate: clean_(b.preferredDate, 10), slot: clean_(b.slot, 20) };
      if (!job.name) return fail_('Please enter your name.');
      if (digits_(job.phone).length < 10) return fail_('Please enter a 10 digit phone number.');
      if (!job.problem) return fail_('Please describe the problem.');
      if (job.preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(job.preferredDate)) job.preferredDate = '';
      var lock = LockService.getScriptLock(); lock.waitLock(20000);
      try {
        var day = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyMMdd'), cache = CacheService.getScriptCache();
        var kPhone = 'book-' + day + '-' + digits_(job.phone), kDay = 'book-' + day;
        var nPhone = Number(cache.get(kPhone) || 0), nDay = Number(cache.get(kDay) || 0);
        if (nPhone >= MAX_PER_PHONE) return fail_('This phone number already has ' + MAX_PER_PHONE + ' bookings today. Please call or WhatsApp us.', 429);
        if (nDay >= MAX_PER_DAY) return fail_('Online booking is busy today. Please call or WhatsApp us.', 429);
        cache.put(kPhone, String(nPhone + 1), 21600); cache.put(kDay, String(nDay + 1), 21600);
        var sh = sheet_(), now = new Date().toISOString();
        job.id = newId_(sh); job.status = 'Booked'; job.createdAt = now; job.history = [{ at: now, status: 'Booked' }];
        sh.appendRow(jobToRow_(job));
      } finally { lock.releaseLock(); }
      return out_({ status: 201, id: job.id });
    }

    if (action === 'status') {
      var f = find_(sheet_(), clean_(b.id, 20).toUpperCase());
      var ph = digits_(b.phone);
      if (!f || ph.length < 10 || ph !== digits_(f.job.phone)) { Utilities.sleep(500); return fail_('No booking matches that job number and phone.', 404); }
      return out_({ job: publicView_(withSignature_(f.job)) });
    }

    // Everything below is for signed-in staff, each action only with its menu permission
    var me = session_(b);
    if (!me) return fail_('Please sign in again.', 401);

    if (action === 'attend') {
      if (b.op === 'mark' ? !me.can('register') : !(me.can('attendance') || me.can('register'))) return denied_();
      if (!me.can('register')) b.engineer = me.rec.name;  // staff can only check themselves in and out
      return attend_(b);
    }
    if (action === 'attlist') {
      if (me.can('register')) return attList_(b);
      if (!me.can('attendance')) return denied_();
      return attList_(b, me.rec.name);
    }
    if (!me.can('service')) return denied_();

    var sh2 = sheet_();

    if (action === 'list') {
      var last = sh2.getLastRow();
      if (last < 2) return out_({ jobs: [] });
      var start = Math.max(2, last - 299);
      var rows = sh2.getRange(start, 1, last - start + 1, COLS.length).getValues();
      return out_({ jobs: rows.filter(function (r) { return r[0]; }).map(rowToJob_).reverse() });
    }

    var id = clean_(b.id, 20).toUpperCase();
    var lock2 = LockService.getScriptLock(); lock2.waitLock(20000);
    try {
      var hit = find_(sh2, id);
      if (!hit) return fail_('Not found.', 404);
      var j = hit.job, nowIso = new Date().toISOString();
      if (action === 'get') return out_({ job: withSignature_(j) });
      if (j.status === 'Closed') return fail_('This job is already closed.', 409);
      if (action === 'assign') {
        j.engineer = clean_(b.engineer, 60); j.visitDate = clean_(b.visitDate, 10);
        if (!j.engineer) return fail_('Enter the engineer name.');
        j.status = 'Assigned';
      } else if (action === 'close') {
        var sig = String(b.signature || '');
        if (!/^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(sig) || sig.length > 400000) return fail_('The customer signature is missing.');
        var c = { engineer: clean_(b.engineer, 60), workDone: clean_(b.workDone, 1500), parts: clean_(b.parts, 500), meter: clean_(b.meter, 30),
          charges: clean_(b.charges, 20), payment: clean_(b.payment, 30), remarks: clean_(b.remarks, 500), signedBy: clean_(b.signedBy, 80) };
        if (!c.engineer) return fail_('Enter the engineer name.');
        if (!c.workDone) return fail_('Describe the work done.');
        if (!c.signedBy) return fail_("Enter the customer's name under the signature.");
        var blob = Utilities.newBlob(Utilities.base64Decode(sig.split(',')[1]), 'image/png', id + '.png');
        var file = folder_().createFile(blob);
        for (var k in c) j[k] = c[k];
        j.signatureFile = file.getId(); j.closedAt = nowIso; j.status = 'Closed';
      } else if (action === 'cancel') {
        j.status = 'Cancelled'; j.cancelReason = clean_(b.reason, 300);
      } else {
        return fail_('Not found.', 404);
      }
      j.history = (j.history || []).concat([{ at: nowIso, status: j.status, by: me.id }]);
      sh2.getRange(hit.row, 1, 1, COLS.length).setValues([jobToRow_(j)]);
      return out_({ job: withSignature_(rowToJob_(jobToRow_(j).map(function (v) { return String(v).replace(/^'/, ''); }))) });
    } finally { lock2.releaseLock(); }
  } catch (err) {
    console.error(err);  // details stay in Apps Script > Executions; the visitor sees a plain message
    return fail_('Something went wrong on the server. Please try again.', 500);
  }
}
