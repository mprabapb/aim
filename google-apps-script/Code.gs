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
 * To change the staff PIN later: sign in on the Engineer page and use "Change PIN". If the PIN is lost,
 * delete PIN_HASH and PIN_SALT under Project settings > Script properties, then create a new one.
 *
 * Every call is a GET (?action=...) or a POST with a JSON body {action, ...}; the reply is JSON
 * with "status" (HTTP-like code) and either the data or "error".
 */
var COLS = ['id', 'status', 'createdAt', 'name', 'org', 'phone', 'email', 'address', 'model', 'serial', 'problem',
  'preferredDate', 'slot', 'engineer', 'visitDate', 'cancelReason', 'closedAt', 'workDone', 'parts', 'meter',
  'charges', 'payment', 'remarks', 'signedBy', 'signatureFile', 'history'];
var MAX_FAILS = 10, LOCK_SECONDS = 900;
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
// A strong PIN: 8 to 64 characters, no spaces, with at least one letter and one number
function pinOk_(pin) { return /^\S{8,64}$/.test(pin) && /[A-Za-z]/.test(pin) && /[0-9]/.test(pin); }
var PIN_RULE = 'Use at least 8 characters with letters and numbers, and no spaces.';
function setPin_(pin) {
  var salt = Utilities.getUuid();
  props_().setProperties({ PIN_SALT: salt, PIN_HASH: hash_(pin, salt) });
}
function hash_(pin, salt) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8));
}

// Staff check: one PIN for the shop, saved as a salted hash; locks for 15 min after 10 wrong tries.
// The count is read and written under a lock, so many guesses sent at once cannot slip past it.
function staff_(b) {
  var p = props_(), h = p.getProperty('PIN_HASH');
  if (!h) return { res: out_({ status: 503, error: 'No staff PIN yet. Create one to start.', setup: true }) };
  var cache = CacheService.getScriptCache(), wrong = false;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var fails = Number(cache.get('pin-fails') || 0);
    if (fails >= MAX_FAILS) return { res: fail_('Too many wrong PINs. Sign-in is locked for 15 minutes.', 429) };
    if (!b._pin || hash_(String(b._pin), p.getProperty('PIN_SALT')) !== h) {
      cache.put('pin-fails', String(fails + 1), LOCK_SECONDS);
      wrong = true;
    }
  } finally { lock.releaseLock(); }
  if (wrong) { Utilities.sleep(800); return { res: fail_('Wrong PIN.', 401) }; }
  return { ok: true };
}

function handle_(b) {
  var action = String(b.action || '');
  try {
    if (action === 'ping') return out_({ ok: true, setup: !props_().getProperty('PIN_HASH') });

    if (action === 'setpin') {
      var lock0 = LockService.getScriptLock(); lock0.waitLock(10000);
      try {
        if (props_().getProperty('PIN_HASH')) return fail_('A staff PIN is already set.', 409);
        var pin = String(b.pin || '');
        if (!pinOk_(pin)) return fail_(PIN_RULE);
        setPin_(pin);
        return out_({ status: 201, ok: true });
      } finally { lock0.releaseLock(); }
    }

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

    // Everything below is for staff only
    var s = staff_(b);
    if (!s.ok) return s.res;

    if (action === 'changepin') {
      var np = String(b.newPin || '');
      if (!pinOk_(np)) return fail_(PIN_RULE);
      var lock1 = LockService.getScriptLock(); lock1.waitLock(10000);
      try { setPin_(np); CacheService.getScriptCache().remove('pin-fails'); } finally { lock1.releaseLock(); }
      return out_({ ok: true });
    }

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
      j.history = (j.history || []).concat([{ at: nowIso, status: j.status }]);
      sh2.getRange(hit.row, 1, 1, COLS.length).setValues([jobToRow_(j)]);
      return out_({ job: withSignature_(rowToJob_(jobToRow_(j).map(function (v) { return String(v).replace(/^'/, ''); }))) });
    } finally { lock2.releaseLock(); }
  } catch (err) {
    console.error(err);  // details stay in Apps Script > Executions; the visitor sees a plain message
    return fail_('Something went wrong on the server. Please try again.', 500);
  }
}
