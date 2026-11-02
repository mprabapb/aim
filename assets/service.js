// Online service booking, booking status check and the engineer job page.
// Talks to the jobs API: a Google Apps Script web app (google-apps-script/Code.gs) or
// netlify/functions/jobs.mjs. Where the API is not reachable
// (for example on the GitHub Pages copy), booking falls back to WhatsApp.
(function () {
  // Folder this script was loaded from (used for the PDF libraries kept in assets/vendor)
  var HERE = ((document.currentScript && document.currentScript.src) || '').replace(/[^\/]*$/, '');
  // data-api may list several servers (comma separated); the first one that answers is used.
  // On a Netlify site the page's own server is tried first.
  var BASES = (document.body.dataset.api || '').split(',').map(function (b) { return b.trim().replace(/\/$/, ''); }).filter(Boolean);
  if (/\.netlify\.app$/.test(location.hostname) || !BASES.length) BASES.unshift('');
  var apiBase = null, apiTried = [];
  // No API configured and not on Netlify: GitHub Pages only. Bookings go by WhatsApp and the
  // engineer's signed job sheet is made on the phone (saved as PDF / image, sent on WhatsApp).
  var OFFLINE = !(document.body.dataset.api || '').trim() && !/\.netlify\.app$/.test(location.hostname);
  var ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  function newJobId() {
    var d = new Date(Date.now() + 5.5 * 3600e3), r = '';
    for (var k = 0; k < 4; k++) r += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    return 'SR-' + d.toISOString().slice(2, 10).replace(/-/g, '') + '-' + r;
  }
  // A Google Apps Script web app (google-apps-script/Code.gs) backed by a Google Sheet
  function isGas(base) { return /script\.google(usercontent)?\.com/.test(base); }
  function isJson(r) { return (r.headers.get('content-type') || '').indexOf('application/json') !== -1; }
  function findApi(i) {
    if (apiBase !== null) return Promise.resolve(apiBase);
    i = i || 0;
    if (i >= BASES.length) return Promise.reject(new Error('offline'));
    var name = BASES[i] ? BASES[i].replace(/^https?:\/\//, '') : location.host;
    return fetch(BASES[i] + (isGas(BASES[i]) ? '?action=ping' : '/api/jobs'), { method: 'GET' }).then(function (r) {
      if (!isJson(r)) { apiTried.push(name + ': ' + r.status + ' ' + (r.headers.get('content-type') || 'no type').split(';')[0]); throw new Error('no api'); }
      return (apiBase = BASES[i]);
    }, function (e) { apiTried.push(name + ': ' + (e && e.message || 'network error')); throw e; })
      .catch(function () { return findApi(i + 1); });
  }
  var WA = document.body.dataset.wa;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function fmtDate(iso, withTime) {
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
    var o = { day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime) { o.hour = 'numeric'; o.minute = '2-digit'; }
    return d.toLocaleString('en-IN', o);
  }
  function call(path, opts) {
    opts = opts || {};
    // Plain GETs and text/plain POSTs only, so browsers send them across sites without a preflight
    var method = opts.method || 'GET', body = opts.body;
    if (opts.pin) {
      body = Object.assign({}, body || {}, { _pin: opts.pin });
      if (method === 'GET') { body._get = true; method = 'POST'; }
    }
    var init = { method: method };
    if (body) { init.body = JSON.stringify(body); init.headers = { 'content-type': 'text/plain' }; }
    var offline = function () { var e = new Error('offline'); e.offline = true; throw e; };
    return findApi().then(function (base) {
      if (!isGas(base)) return fetch(base + '/api/jobs' + path, init);
      // Apps Script: map the REST-style path to {action, id, ...}; replies always come back as HTTP 200
      var m = path.match(/^\/([^\/?]+)(?:\/(assign|close|cancel))?(?:\?phone=(.*))?$/), b = Object.assign({}, body || {});
      if (path === '/attendance') b.action = b._get ? 'attlist' : 'attend';
      else if (path === '/staff-pin') b.action = opts.pin ? 'changepin' : 'setpin';
      else if (!m) b.action = opts.pin ? 'list' : 'book';
      else if (m[3] !== undefined) {
        return fetch(base + '?action=status&id=' + m[1] + '&phone=' + m[3], { method: 'GET' });
      } else { b.action = m[2] || 'get'; b.id = decodeURIComponent(m[1]); }
      delete b._get;
      return fetch(base, { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'text/plain' } });
    }, offline)
      .then(function (r) {
        if (!isJson(r)) offline();
        return r.json().then(function (data) {
          var code = data.status && data.status >= 400 ? data.status : r.ok ? 0 : r.status;
          if (code || data.error) { var err = new Error(data.error || 'Something went wrong.'); err.status = code || 400; err.data = data; throw err; }
          return data;
        });
      }, function (e) { if (e && e.status) throw e; offline(); });
  }
  function waText(phone, text) {
    var p = String(phone || '').replace(/\D/g, '');
    if (p.length === 10) p = '91' + p;
    return 'https://wa.me/' + p + '?text=' + encodeURIComponent(text);
  }
  function setMsg(el, text, bad) { el.textContent = text || ''; el.classList.toggle('bad', !!bad); el.hidden = !text; }

  // ---------- Service report (shared by the customer status check and the engineer page) ----------
  var STATUS_NOTE = { Booked: 'Booking received. We will call you to confirm the visit.', Assigned: 'An engineer has been assigned.',
    Closed: 'Service completed and signed off.', Cancelled: 'This booking was cancelled.' };
  function row(label, value) { return value ? '<tr><th>' + esc(label) + '</th><td>' + esc(value) + '</td></tr>' : ''; }
  function reportHtml(j, staff) {
    var c = j.closure || {};
    var h = '<div class="sr-head"><div><p class="eyebrow">Service Report</p><h3>' + esc(j.id) + '</h3></div>' +
      '<span class="sr-status s-' + esc(String(j.status).toLowerCase()) + '">' + esc(j.status) + '</span></div>' +
      '<p class="small">' + esc(STATUS_NOTE[j.status] || '') + '</p>' +
      '<table class="ctable spec-table sr-table"><tbody>' +
      row('Booked on', fmtDate(j.createdAt, true)) + row('Customer', j.name) + row('Organisation', j.org) +
      (staff ? row('Phone', j.phone) + row('Email', j.email) + row('Address', j.address) : '') +
      row('Machine', j.model) + row('Serial no.', j.serial) + row('Problem reported', j.problem) +
      row('Preferred visit', [fmtDate(j.preferredDate), j.slot].filter(Boolean).join(', ')) +
      row('Engineer', j.engineer) + row('Visit date', fmtDate(j.visitDate)) +
      (j.status === 'Cancelled' ? row('Reason', j.cancelReason) : '') +
      (j.status === 'Closed' ? row('Closed on', fmtDate(c.closedAt, true)) + row('Work done', c.workDone) + row('Parts replaced', c.parts) +
        row('Meter reading', c.meter) + row('Charges', c.charges ? '₹ ' + c.charges : '') + row('Payment', c.payment) + row('Remarks', c.remarks) : '') +
      '</tbody></table>';
    if (j.status === 'Closed') {
      h += '<div class="sr-sign">' + (c.signature ? '<img src="' + esc(c.signature) + '" alt="Customer signature">' : c.hasSignature ? '<p class="small">Signature on file</p>' : '') +
        '<p>Customer signature: <b>' + esc(c.signedBy) + '</b></p>' +
        '<p class="small">I confirm the above work was carried out to my satisfaction.</p></div>';
    }
    return h;
  }
  function reportSummary(j) {
    var c = j.closure || {};
    return ['AIM Enterprises: Service Report ' + j.id, 'Status: ' + j.status, 'Machine: ' + (j.model || '-'), 'Engineer: ' + (j.engineer || '-'),
      c.workDone ? 'Work done: ' + c.workDone : '', c.parts ? 'Parts: ' + c.parts : '', c.charges ? 'Charges: Rs ' + c.charges + (c.payment ? ' (' + c.payment + ')' : '') : '',
      c.signedBy ? 'Signed by: ' + c.signedBy : '', OFFLINE ? '' : 'Check status: ' + location.origin + location.pathname.replace(/[^/]*$/, '') + 'service.html#track']
      .filter(Boolean).join('\n');
  }

  // ---------- Booking form ----------
  var book = document.getElementById('book');
  if (book) {
    var params = new URLSearchParams(location.search);
    if (params.get('model')) book.elements.model.value = params.get('model');
    var today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (book.elements.preferredDate) book.elements.preferredDate.min = today;
    var bookMsg = $('.form-msg', book);
    var via = 'online';
    book.querySelectorAll('button[data-via]').forEach(function (b) { b.addEventListener('click', function () { via = b.dataset.via; }); });
    var fields = ['name', 'org', 'phone', 'email', 'address', 'model', 'serial', 'problem', 'preferredDate', 'slot', 'website'];
    var waFallback = function (data, id) {
      var lines = ['Service request' + (id ? ' ' + id : '') + ' from website'];
      [['Name', 'name'], ['Organisation', 'org'], ['Phone', 'phone'], ['Email', 'email'], ['Address', 'address'], ['Model', 'model'], ['Serial no.', 'serial'],
        ['Problem', 'problem'], ['Preferred date', 'preferredDate'], ['Time', 'slot']].forEach(function (p) { if (data[p[1]]) lines.push(p[0] + ': ' + data[p[1]]); });
      return 'https://wa.me/' + WA + '?text=' + encodeURIComponent(lines.join('\n'));
    };
    book.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = {};
      fields.forEach(function (f) { if (book.elements[f]) data[f] = book.elements[f].value.trim(); });
      if (via === 'whatsapp' && !OFFLINE) { window.open(waFallback(data), '_blank', 'noopener'); return; }
      if (OFFLINE) {
        if (data.website) return;
        var jid = newJobId();
        window.open(waFallback(data, jid), '_blank', 'noopener');
        book.innerHTML = '<div class="booked"><h2>Almost Done</h2><p>Your job number is</p><p class="job-no">' + esc(jid) + '</p>' +
          '<p>WhatsApp has opened with your booking. <b>Tap Send in WhatsApp</b> to confirm it. We will call you on <b>' + esc(data.phone) + '</b> to fix the visit.</p>' +
          '<p><a class="btn btn-wa" target="_blank" rel="noopener" href="' + esc(waFallback(data, jid)) + '">Open WhatsApp again</a></p></div>';
        book.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      var btn = $('button[data-via="online"]', book);
      btn.disabled = true; setMsg(bookMsg, 'Booking…');
      call('', { method: 'POST', body: data }).then(function (res) {
        book.innerHTML = '<div class="booked"><h2>Service Booked</h2><p>Your job number is</p><p class="job-no">' + esc(res.id) + '</p>' +
          '<p>Keep this number. We will call you on <b>' + esc(data.phone) + '</b> to confirm the visit. You can check progress under <a href="#track">Check Booking Status</a>.</p>' +
          '<p><a class="btn btn-wa" target="_blank" rel="noopener" href="' + esc(waFallback(data, res.id)) + '">Also send on WhatsApp</a></p></div>';
        try { localStorage.setItem('aim-last-job', JSON.stringify({ id: res.id, phone: data.phone })); } catch (err) {}
        var t = document.getElementById('track');
        if (t) { t.elements.id.value = res.id; t.elements.phone.value = data.phone; }
        book.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, function (err) {
        btn.disabled = false;
        if (err.offline) {
          setMsg(bookMsg, 'Online booking is not available right now, so we opened WhatsApp with your details instead.');
          window.open(waFallback(data), '_blank', 'noopener');
        } else setMsg(bookMsg, err.message, true);
      });
    });
  }

  // ---------- Status check ----------
  var track = document.getElementById('track');
  if (track && OFFLINE) { track.hidden = true; }
  else if (track) {
    var out = $('.track-result', track.parentNode);
    var trackMsg = $('.form-msg', track);
    try {
      var last = JSON.parse(localStorage.getItem('aim-last-job') || 'null');
      if (last) { track.elements.id.value = last.id; track.elements.phone.value = last.phone; }
    } catch (err) {}
    track.addEventListener('submit', function (e) {
      e.preventDefault();
      var id = track.elements.id.value.trim().toUpperCase();
      setMsg(trackMsg, 'Checking…'); out.hidden = true;
      call('/' + encodeURIComponent(id) + '?phone=' + encodeURIComponent(track.elements.phone.value)).then(function (res) {
        setMsg(trackMsg, '');
        out.innerHTML = reportHtml(res.job, false) + '<p class="no-print"><button class="btn btn-ghost js-print" type="button">Print or save as PDF</button></p>';
        $('.js-print', out).addEventListener('click', function () { window.print(); });
        out.hidden = false;
      }, function (err) { setMsg(trackMsg, err.offline ? 'Status check is not available right now. Please call or WhatsApp us.' : err.message, true); });
    });
  }

  // ---------- Engineer page ----------
  var app = document.getElementById('engineer-app');
  if (!app) return;
  // Never run the staff page inside another site's frame (stops click-jacking tricks)
  if (window.top !== window.self) { app.innerHTML = '<p>Please open this page directly.</p>'; return; }
  if (OFFLINE) { jobSheet(); return; }
  var store = { get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var pin = '';
  try { pin = sessionStorage.getItem('aim-pin') || ''; } catch (e) {}
  var jobs = [];
  var filter = 'open';
  var login = $('#eng-login'), board = $('#eng-board'), list = $('#eng-list'), detail = $('#eng-detail');
  var loginMsg = $('.form-msg', login);

  // Engineer names: everyone who appears on a job, plus names typed on this phone
  function engineerNames() {
    var saved = []; try { saved = JSON.parse(store.get('aim-engineers') || '[]'); } catch (e) {}
    var all = saved.concat(jobs.map(function (j) { return j.engineer; }));
    var seen = {}, out = [];
    all.forEach(function (n) { n = String(n || '').trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function rememberEngineer(n) {
    if (!n) return;
    var saved = []; try { saved = JSON.parse(store.get('aim-engineers') || '[]'); } catch (e) {}
    if (saved.indexOf(n) < 0) { saved.push(n); store.set('aim-engineers', JSON.stringify(saved.slice(-30))); }
  }
  function engineerList() { return '<datalist id="eng-names">' + engineerNames().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>'; }
  var who = store.get('aim-show-engineer');
  function whoSelect() {
    var sel = $('#eng-who'); if (!sel) return;
    var names = engineerNames();
    sel.innerHTML = '<option value="">All engineers</option>' + names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    sel.value = names.indexOf(who) >= 0 ? who : '';
  }
  function badge(s) { return '<span class="sr-status s-' + esc(s.toLowerCase()) + '">' + esc(s) + '</span>'; }
  function renderList() {
    whoSelect();
    var shown = jobs.filter(function (j) { return !who || j.engineer === who; }).filter(function (j) { return filter === 'all' || (filter === 'open' ? j.status === 'Booked' || j.status === 'Assigned' : j.status === filter); });
    $('#eng-count').textContent = jobs.filter(function (j) { return j.status === 'Booked' || j.status === 'Assigned'; }).length + ' open';
    list.innerHTML = shown.length ? shown.map(function (j) {
      return '<button class="job-row" data-id="' + esc(j.id) + '"><span><b>' + esc(j.name) + '</b>' + (j.org ? ' · ' + esc(j.org) : '') +
        '<br><span class="small">' + esc(j.id) + ' · ' + esc(j.model || 'Model not given') + ' · ' + esc(fmtDate(j.preferredDate || j.createdAt)) + (j.engineer ? ' · ' + esc(j.engineer) : '') + '</span></span>' + badge(j.status) + '</button>';
    }).join('') : '<p class="small">No jobs here.</p>';
  }
  function load() {
    return call('', { pin: pin }).then(function (res) { jobs = res.jobs; renderList(); });
  }
  var setupMode = false;
  function showSetup(on) {
    setupMode = on;
    $('h2', login).textContent = on ? 'Create Staff PIN' : 'Sign In';
    $('button[type="submit"]', login).textContent = on ? 'Save PIN' : 'Open Jobs';
    login.elements.pin.setAttribute('autocomplete', on ? 'new-password' : 'current-password');
  }
  function enter() {
    setMsg(loginMsg, 'Checking…');
    load().then(function () {
      try { sessionStorage.setItem('aim-pin', pin); } catch (e) {}
      login.hidden = true; board.hidden = false; setMsg(loginMsg, '');
      attToday();
      if (!pinOk(pin)) openPinForm('Your staff PIN is too easy to guess. Please choose a new one now: at least 8 characters with letters and numbers.');
    }, function (err) {
      pin = ''; login.hidden = false; board.hidden = true;
      if (err.data && err.data.setup) {
        showSetup(true);
        setMsg(loginMsg, 'No staff PIN has been set yet. Choose one now: at least 8 characters with letters and numbers. Engineers will use it to sign in.');
        return;
      }
      setMsg(loginMsg, err.offline ? 'The job server is not reachable. Details for support: ' + (apiTried.join(' | ') || 'no server tried') : err.message, true);
    });
  }
  function pinOk(p) { return /^\S{8,64}$/.test(p) && /[A-Za-z]/.test(p) && /[0-9]/.test(p); }
  // Change PIN (staff only): the new PIN replaces the old one for every engineer
  var pinForm = $('#eng-pin-form'), pinMsg = pinForm && $('.form-msg', pinForm);
  function openPinForm(note) {
    if (!pinForm) return;
    pinForm.reset(); pinForm.hidden = false;
    setMsg(pinMsg, note || 'The new PIN replaces the old one for all engineers. Tell them the new PIN.', !!note);
    pinForm.elements.newPin.focus();
  }
  if (pinForm) {
    $('#eng-pin').addEventListener('click', function () { openPinForm(); });
    $('#eng-pin-cancel').addEventListener('click', function () { pinForm.hidden = true; });
    pinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var np = pinForm.elements.newPin.value;
      if (!pinOk(np)) { setMsg(pinMsg, 'Use at least 8 characters with letters and numbers, and no spaces.', true); return; }
      if (np !== pinForm.elements.newPin2.value) { setMsg(pinMsg, 'The two PINs do not match.', true); return; }
      setMsg(pinMsg, 'Saving…');
      call('/staff-pin', { method: 'POST', pin: pin, body: { newPin: np } }).then(function () {
        pin = np;
        try { sessionStorage.setItem('aim-pin', pin); } catch (err) {}
        pinForm.hidden = true;
        alert('Staff PIN changed. Tell your engineers the new PIN.');
      }, function (err) {
        setMsg(pinMsg, err.status === 404 ? 'The job server needs the latest update before the PIN can be changed. Please ask the office.' : err.message, true);
      });
    });
  }
  login.addEventListener('submit', function (e) {
    e.preventDefault();
    pin = login.elements.pin.value;
    if (!setupMode) { enter(); return; }
    if (!pinOk(pin)) { setMsg(loginMsg, 'Use at least 8 characters with letters and numbers, and no spaces.', true); return; }
    setMsg(loginMsg, 'Saving…');
    call('/staff-pin', { method: 'POST', body: { pin: pin } }).then(function () { showSetup(false); enter(); },
      function (err) { setMsg(loginMsg, err.message, true); if (err.status === 409) showSetup(false); });
  });
  if (pin) enter();
  $('#eng-logout').addEventListener('click', function () { try { sessionStorage.removeItem('aim-pin'); } catch (e) {} location.reload(); });
  $('#eng-refresh').addEventListener('click', function () { load(); });
  $('#eng-who').addEventListener('change', function () { who = this.value; store.set('aim-show-engineer', who); renderList(); });
  document.querySelectorAll('#eng-tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.filter;
      document.querySelectorAll('#eng-tabs button').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      renderList();
    });
  });
  list.addEventListener('click', function (e) {
    var r = e.target.closest('.job-row');
    if (r) openJob(r.dataset.id);
  });
  $('#eng-back').addEventListener('click', function () { detail.hidden = true; board.hidden = false; load(); });

  // ---------- Engineer attendance ----------
  // Check-in / check-out from the engineer's phone (server time + GPS location when allowed),
  // office marks for leave, holidays and fixes, and a monthly register (PDF / CSV).
  var attCache = {};
  var attForm = $('#att-today'), attView = $('#eng-att'), attMsg = $('#att-msg');
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function ist(iso) { return new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString(); }
  function todayIst() { return ist(new Date().toISOString()).slice(0, 10); }
  function hhmm(iso) { return ist(iso).slice(11, 16); }
  function ampm(t) {
    if (!t) return '';
    var h = +t.slice(0, 2), m = t.slice(3, 5);
    return (h % 12 || 12) + ':' + m + (h < 12 ? ' am' : ' pm');
  }
  function mins(t) { return +t.slice(0, 2) * 60 + +t.slice(3, 5); }
  function fmtHours(m) { return m ? Math.floor(m / 60) + 'h ' + ('0' + (m % 60)).slice(-2) + 'm' : ''; }
  function attLoad(month, fresh) {
    if (attCache[month] && !fresh) return Promise.resolve(attCache[month]);
    return call('/attendance', { pin: pin, body: { month: month } }).then(function (res) { return (attCache[month] = res.entries || []); });
  }
  function attNames(entries) {
    var seen = {}, out = [];
    (entries || []).map(function (e) { return e.engineer; }).concat(engineerNames()).forEach(function (n) {
      n = String(n || '').trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); }
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function fillNames(entries) {
    $('#att-names').innerHTML = attNames(entries).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  }
  var same = function (a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); };
  // One engineer's day: office mark wins for the status; its times (if given) replace the phone times
  function dayInfo(entries, name, date) {
    var es = entries.filter(function (e) { return e.date === date && same(e.engineer, name); });
    var marks = es.filter(function (e) { return e.by === 'office'; }), mark = marks[marks.length - 1];
    var ins = es.filter(function (e) { return e.kind === 'In'; }), outs = es.filter(function (e) { return e.kind === 'Out'; });
    var firstIn = ins[0], lastOut = outs[outs.length - 1];
    var inT = (mark && mark.inTime) || (firstIn ? hhmm(firstIn.at) : '');
    var outT = (mark && mark.outTime) || (lastOut ? hhmm(lastOut.at) : '');
    var status = mark ? mark.kind : firstIn ? 'Present' : '';
    var worked = inT && outT && mins(outT) > mins(inT) ? mins(outT) - mins(inT) : 0;
    var late = (status === 'Present' || status === 'Half day') && inT && mins(inT) > 9 * 60 + 15;
    return { date: date, name: name, status: status, inT: inT, outT: outT, worked: worked, late: late,
      inLoc: firstIn && firstIn.lat ? firstIn : null, outLoc: lastOut && lastOut.lat ? lastOut : null,
      note: mark ? mark.note : '', count: es.length };
  }
  function mapLink(e, label) {
    return e ? '<a target="_blank" rel="noopener" href="https://www.google.com/maps?q=' + encodeURIComponent(e.lat + ',' + e.lng) + '">' + label + '</a>' : '';
  }

  // Today's card on the job list
  if (attForm) {
    var attOp = 'in', attFMsg = $('.form-msg', attForm);
    attForm.elements.me.value = store.get('aim-engineer');
    attForm.querySelectorAll('button[data-op]').forEach(function (b) { b.addEventListener('click', function () { attOp = b.dataset.op; }); });
    attForm.elements.me.addEventListener('change', function () { showToday(attCache[todayIst().slice(0, 7)] || []); });
    attForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var me = attForm.elements.me.value.trim().replace(/\s+/g, ' '), op = attOp;
      if (!me) { setMsg(attFMsg, 'Type or pick your name first.', true); return; }
      var d = dayInfo(attCache[todayIst().slice(0, 7)] || [], me, todayIst());
      if (op === 'in' && d.inT && !d.outT && !confirm(me + ' already checked in today at ' + ampm(d.inT) + '. Check in again?')) return;
      if (op === 'out' && !d.inT && !confirm(me + ' has not checked in today. Check out anyway?')) return;
      store.set('aim-engineer', me); rememberEngineer(me);
      var btns = attForm.querySelectorAll('button'); btns.forEach(function (b) { b.disabled = true; });
      setMsg(attFMsg, 'Getting your location…');
      getLocation().then(function (loc) {
        setMsg(attFMsg, 'Saving…');
        return call('/attendance', { method: 'POST', pin: pin, body: { op: op, engineer: me, lat: loc ? loc.lat : '', lng: loc ? loc.lng : '', acc: loc ? loc.acc : '' } })
          .then(function (res) {
            var a = res.entry, m = a.date.slice(0, 7);
            attCache[m] = (attCache[m] || []).concat([a]);
            showToday(attCache[m]);
            setMsg(attFMsg, (op === 'in' ? 'Checked in' : 'Checked out') + ' at ' + ampm(hhmm(a.at)) + '. ' +
              (a.lat ? 'Location saved.' : 'Location NOT saved: allow location for this site and turn on GPS next time.'), !a.lat);
            if (a.lat) attFMsg.classList.add('ok-msg');
          });
      }).catch(function (err) {
        setMsg(attFMsg, err.status === 404 ? 'The job server needs the latest update before attendance works. Please ask the office.' :
          err.offline ? 'Not saved: no internet. Please try again.' : 'Not saved: ' + err.message, true);
      }).then(function () { btns.forEach(function (b) { b.disabled = false; }); });
    });
  }
  function getLocation() {
    return new Promise(function (ok) {
      if (!navigator.geolocation) return ok(null);
      navigator.geolocation.getCurrentPosition(function (p) { ok({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); },
        function () { ok(null); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  }
  function showToday(entries) {
    if (!attForm) return;
    fillNames(entries);
    var me = attForm.elements.me.value.trim(), el = $('#att-state');
    if (!me) { el.textContent = 'Pick your name, then tap Check In when you start work and Check Out when you finish.'; return; }
    var d = dayInfo(entries, me, todayIst());
    el.innerHTML = 'Today, ' + esc(fmtDate(todayIst())) + ': ' + (d.status && !d.inT && !d.outT ? '<b>' + esc(d.status) + '</b>' :
      d.inT ? 'In <b>' + esc(ampm(d.inT)) + '</b>' + (d.late ? ' (late)' : '') + (d.outT ? ', Out <b>' + esc(ampm(d.outT)) + '</b>, ' + esc(fmtHours(d.worked)) : ', not checked out yet') :
      'not checked in yet');
  }
  function attToday() {
    if (!attForm) return;
    showToday([]);
    attLoad(todayIst().slice(0, 7), true).then(showToday, function (err) {
      if (err.status === 404) $('#att-state').textContent = 'Attendance needs the latest job server update. Please ask the office.';
    });
  }

  // Monthly register
  var attMonth = $('#att-month'), attWho = $('#att-who'), attRows = [], attSum = [];
  function monthDays(month) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7), n = new Date(Date.UTC(y, m, 0)).getUTCDate(), t = todayIst(), out = [];
    for (var d = 1; d <= n; d++) {
      var iso = month + '-' + ('0' + d).slice(-2);
      if (iso > t) break;
      out.push({ iso: iso, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() });
    }
    return out;
  }
  function monthName(month) { return new Date(month + '-01T00:00:00').toLocaleString('en-IN', { month: 'long', year: 'numeric' }); }
  function renderRegister(entries) {
    var month = attMonth.value, who = attWho.value;
    var names = attNames(entries.length ? entries : []).filter(function (n) { return entries.some(function (e) { return same(e.engineer, n); }); });
    var keep = who;
    attWho.innerHTML = '<option value="">All engineers</option>' + names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
    attWho.value = names.indexOf(keep) >= 0 ? keep : '';
    who = attWho.value;
    var people = who ? [who] : names, days = monthDays(month);
    attRows = []; attSum = [];
    people.forEach(function (n) {
      var s = { name: n, Present: 0, 'Half day': 0, Leave: 0, Absent: 0, Holiday: 0, none: 0, late: 0, mins: 0 };
      days.forEach(function (d) {
        var x = dayInfo(entries, n, d.iso); x.dow = d.dow;
        if (x.status) s[x.status] = (s[x.status] || 0) + 1; else if (d.dow !== 0) s.none++;
        if (x.late) s.late++;
        s.mins += x.worked;
        attRows.push(x);
      });
      attSum.push(s);
    });
    attRows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name); });
    $('#att-summary').innerHTML = people.length ? '<thead><tr><th>Engineer</th><th class="num">Present</th><th class="num">Half day</th><th class="num">Leave</th><th class="num">Absent</th><th class="num">Holiday</th><th class="num">Not marked</th><th class="num">Late</th><th class="num">Hours</th></tr></thead><tbody>' +
      attSum.map(function (s) {
        return '<tr><th>' + esc(s.name) + '</th>' + [s.Present, s['Half day'], s.Leave, s.Absent, s.Holiday, s.none, s.late].map(function (v) { return '<td class="num">' + v + '</td>'; }).join('') +
          '<td class="num">' + esc(fmtHours(s.mins) || '0h') + '</td></tr>';
      }).join('') + '</tbody>' : '<tbody><tr><td>No attendance yet for ' + esc(monthName(month)) + '.</td></tr></tbody>';
    var shown = attRows.filter(function (x) { return x.status || x.count || x.dow !== 0; });
    $('#att-days').innerHTML = shown.length ? '<thead><tr><th>Date</th>' + (who ? '' : '<th>Engineer</th>') + '<th>Status</th><th>In</th><th>Out</th><th class="num">Hours</th><th>Location</th><th>Note</th></tr></thead><tbody>' +
      shown.map(function (x) {
        return '<tr' + (x.dow === 0 && !x.status ? ' class="att-off"' : '') + '><td>' + esc(DAYS[x.dow] + ' ' + fmtDate(x.date)) + '</td>' + (who ? '' : '<td>' + esc(x.name) + '</td>') +
          '<td>' + esc(x.status || (x.dow === 0 ? 'Sunday' : 'Not marked')) + '</td>' +
          '<td' + (x.late ? ' class="att-late" title="After 9:15 am"' : '') + '>' + esc(ampm(x.inT)) + '</td><td>' + esc(ampm(x.outT)) + '</td>' +
          '<td class="num">' + esc(fmtHours(x.worked)) + '</td><td>' + [mapLink(x.inLoc, 'In'), mapLink(x.outLoc, 'Out')].filter(Boolean).join(' · ') + '</td>' +
          '<td>' + esc(x.note) + '</td></tr>';
      }).join('') + '</tbody>' : '';
  }
  function loadRegister(fresh) {
    setMsg(attMsg, 'Loading…');
    return attLoad(attMonth.value, fresh).then(function (entries) { setMsg(attMsg, ''); fillNames(entries); renderRegister(entries); },
      function (err) { setMsg(attMsg, err.status === 404 ? 'The job server needs the latest update before attendance works.' : err.message, true); });
  }
  if (attView) {
    $('#eng-att-open').addEventListener('click', function () {
      board.hidden = true; attView.hidden = false;
      if (!attMonth.value) attMonth.value = todayIst().slice(0, 7);
      attMonth.max = todayIst().slice(0, 7);
      var mf = $('#att-mark');
      if (!mf.elements.date.value) mf.elements.date.value = todayIst();
      mf.elements.date.max = todayIst().slice(0, 4) + '-12-31';
      loadRegister(true); window.scrollTo(0, 0);
    });
    $('#att-back').addEventListener('click', function () { attView.hidden = true; board.hidden = false; attToday(); });
    attMonth.addEventListener('change', function () { if (/^\d{4}-\d{2}$/.test(attMonth.value)) loadRegister(false); });
    attWho.addEventListener('change', function () { renderRegister(attCache[attMonth.value] || []); });
    $('#att-reload').addEventListener('click', function () { loadRegister(true); });
    $('#att-csv').addEventListener('click', attCsv);
    $('#att-pdf').addEventListener('click', attPdf);
    var mf = $('#att-mark'), mMsg = $('.form-msg', mf);
    mf.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = mf.elements, data = { op: 'mark' };
      ['engineer', 'date', 'mark', 'inTime', 'outTime', 'note'].forEach(function (k) { data[k] = f[k].value.trim(); });
      data.engineer = data.engineer.replace(/\s+/g, ' ');
      if (data.inTime && data.outTime && data.outTime <= data.inTime) { setMsg(mMsg, 'Out time must be after In time.', true); return; }
      var btn = $('button[type="submit"]', mf); btn.disabled = true; setMsg(mMsg, 'Saving…');
      call('/attendance', { method: 'POST', pin: pin, body: data }).then(function (res) {
        btn.disabled = false;
        var a = res.entry, m = a.date.slice(0, 7);
        if (attCache[m]) attCache[m] = attCache[m].concat([a]);
        setMsg(mMsg, 'Saved: ' + a.engineer + ', ' + fmtDate(a.date) + ', ' + a.kind + '.'); mMsg.classList.add('ok-msg');
        f.inTime.value = ''; f.outTime.value = ''; f.note.value = '';
        if (m === attMonth.value) renderRegister(attCache[m] || []); else { attMonth.value = m; loadRegister(true); }
      }, function (err) { btn.disabled = false; setMsg(mMsg, 'Not saved: ' + err.message, true); });
    });
  }
  function attTableRows() {
    var who = attWho.value;
    return attRows.filter(function (x) { return x.status || x.count || x.dow !== 0; }).map(function (x) {
      var r = [DAYS[x.dow] + ' ' + fmtDate(x.date)];
      if (!who) r.push(x.name);
      return r.concat([x.status || (x.dow === 0 ? 'Sunday' : 'Not marked'), ampm(x.inT) + (x.late ? ' (late)' : ''), ampm(x.outT), fmtHours(x.worked),
        [x.inLoc ? 'In ' + x.inLoc.lat + ',' + x.inLoc.lng : '', x.outLoc ? 'Out ' + x.outLoc.lat + ',' + x.outLoc.lng : ''].filter(Boolean).join(' / '), x.note || '']);
    });
  }
  function attHead() { return ['Date'].concat(attWho.value ? [] : ['Engineer'], ['Status', 'In', 'Out', 'Hours', 'Location', 'Note']); }
  function attFileName(ext) { return ('Attendance ' + monthName(attMonth.value) + (attWho.value ? ' ' + attWho.value : '')).replace(/[^\w .-]+/g, '') + '.' + ext; }
  function saveBlob(blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function attCsv() {
    var q = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    var lines = [['Engineer', 'Present', 'Half day', 'Leave', 'Absent', 'Holiday', 'Not marked', 'Late', 'Hours']].concat(attSum.map(function (s) {
      return [s.name, s.Present, s['Half day'], s.Leave, s.Absent, s.Holiday, s.none, s.late, fmtHours(s.mins) || '0h'];
    }), [[]], [attHead()], attTableRows());
    saveBlob(new Blob(['﻿' + lines.map(function (r) { return r.map(q).join(','); }).join('\r\n')], { type: 'text/csv' }), attFileName('csv'));
  }
  function attPdf() {
    pdfReady().then(function () {
      var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      var W = 210, M = 12, R = [228, 25, 32], G = [90, 90, 90], y = 12;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(R[0], R[1], R[2]); doc.text('AIM ENTERPRISES', M, y + 6);
      doc.setFontSize(8.5); doc.setTextColor(30, 30, 30); doc.text('Canon Authorized Premium Business Partner  |  Canon Service Edge (CSP)', M, y + 11);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(G[0], G[1], G[2]);
      ['Shop No. 3, Opp. BJP Bhawan, MG Road,', 'Sri Vijaya Puram - 744101', 'GSTIN: 35AKEPP1123F1ZM'].forEach(function (t, i) { doc.text(t, W - M, y + i * 3.4, { align: 'right' }); });
      y += 14; doc.setDrawColor(R[0], R[1], R[2]); doc.setLineWidth(0.8); doc.line(M, y, W - M, y);
      y += 7; doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(0, 0, 0);
      doc.text('ENGINEER ATTENDANCE REGISTER: ' + monthName(attMonth.value).toUpperCase() + (attWho.value ? ' (' + attWho.value + ')' : ''), W / 2, y, { align: 'center' });
      y += 4;
      var head = { fillColor: R, textColor: 255, fontStyle: 'bold', fontSize: 8 };
      var base = { fontSize: 8, cellPadding: 1.4, lineColor: [170, 170, 170], lineWidth: 0.2, textColor: [20, 20, 20], valign: 'top' };
      doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: base, headStyles: head,
        head: [['Engineer', 'Present', 'Half day', 'Leave', 'Absent', 'Holiday', 'Not marked', 'Late', 'Hours']],
        body: attSum.map(function (s) { return [s.name, s.Present, s['Half day'], s.Leave, s.Absent, s.Holiday, s.none, s.late, fmtHours(s.mins) || '0h']; }) });
      y = doc.lastAutoTable.finalY + 5;
      var rows = attTableRows().map(function (r) { return r.slice(0, -2).concat([r[r.length - 2] ? 'Yes' : '', r[r.length - 1]]); });
      doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: base, headStyles: head,
        head: [attHead().map(function (h) { return h === 'Location' ? 'GPS' : h; })], body: rows,
        didParseCell: function (d) { if (d.section === 'body' && /Sunday|Holiday/.test(String(d.row.raw[attWho.value ? 1 : 2]))) d.cell.styles.textColor = [130, 130, 130]; } });
      y = doc.lastAutoTable.finalY + 14;
      if (y > 270) { doc.addPage(); y = 30; }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(20, 20, 20);
      doc.text('For AIM ENTERPRISES', W - M, y, { align: 'right' }); doc.text('Authorised Signatory', W - M, y + 12, { align: 'right' });
      var ph = doc.internal.pageSize.getHeight(), n = doc.getNumberOfPages();
      for (var i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFontSize(7); doc.setTextColor(G[0], G[1], G[2]);
        doc.text('In/Out times are server times (IST) from the engineer\'s phone unless marked by the office. Late = in after 9:15 am. Page ' + i + ' of ' + n, W / 2, ph - 7, { align: 'center' });
      }
      var name = attFileName('pdf'), blob = doc.output('blob'), file = new File([blob], name, { type: 'application/pdf' });
      if (navigator.canShare && /Android|iPhone|iPad/i.test(navigator.userAgent) && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: name }).catch(function () { doc.save(name); });
      }
      doc.save(name);
    }).catch(function (e) { alert('Could not make the PDF. Check the internet connection and try again. (' + e.message + ')'); });
  }

  function openJob(id) {
    board.hidden = true; detail.hidden = false;
    var body = $('#eng-job');
    body.innerHTML = '<p class="small">Loading…</p>';
    call('/' + id, { pin: pin }).then(function (res) { showJob(res.job); }, function (err) { body.innerHTML = '<p class="form-msg bad">' + esc(err.message) + '</p>'; });
    window.scrollTo(0, 0);
  }

  function showJob(j, flash) {
    var body = $('#eng-job');
    var open = j.status === 'Booked' || j.status === 'Assigned';
    var me = store.get('aim-engineer');
    var contact = '<p class="eng-actions"><a class="btn btn-ghost" href="tel:' + esc(j.phone) + '">Call ' + esc(j.phone) + '</a>' +
      '<a class="btn btn-ghost" target="_blank" rel="noopener" href="' + esc(waText(j.phone, 'Hello ' + j.name + ', this is AIM Enterprises about your service request ' + j.id + '.')) + '">WhatsApp</a>' +
      (j.address ? '<a class="btn btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(j.address) + '">Map</a>' : '') + '</p>';
    var h = '<div class="sr-report">' + reportHtml(j, true) + '</div>';
    if (open) {
      h += contact +
        '<form class="form" id="eng-assign"><h2>Assign Engineer</h2><div class="form-row">' +
        '<label>Engineer<input name="engineer" list="eng-names" autocomplete="off" required placeholder="Type or pick a name" value="' + esc(j.engineer || '') + '"></label>' +
        '<label>Visit date<input name="visitDate" type="date" value="' + esc(j.visitDate || j.preferredDate || '') + '"></label></div>' +
        '<p class="form-msg" hidden></p><div class="form-actions"><button class="btn" type="submit">Save Engineer</button></div></form>' +
        '<form class="form" id="eng-close"><h2>Close Job</h2>' +
        '<label>Engineer<input name="engineer" list="eng-names" autocomplete="off" required value="' + esc(j.engineer || me) + '"></label>' +
        '<label>Work done<textarea name="workDone" rows="3" required placeholder="Fault found and what was fixed"></textarea></label>' +
        '<label>Parts replaced<input name="parts" placeholder="e.g. Fixing film, pickup roller"></label>' +
        '<div class="form-row"><label>Meter reading<input name="meter" inputmode="numeric"></label>' +
        '<label>Charges (₹)<input name="charges" inputmode="decimal" placeholder="0"></label></div>' +
        '<label>Payment<select name="payment"><option>Under warranty</option><option>Under AMC</option><option>Paid: cash</option><option>Paid: UPI</option><option>To be billed</option><option>No charge</option></select></label>' +
        '<label>Remarks<input name="remarks" placeholder="Advice to customer, next visit…"></label>' +
        '<fieldset class="sig"><legend>Customer signature</legend><canvas id="sig-pad" aria-label="Sign here"></canvas>' +
        '<div class="sig-bar"><span class="small">Ask the customer to sign above with a finger or stylus.</span><button type="button" class="btn btn-ghost" id="sig-clear">Clear</button></div></fieldset>' +
        '<label>Customer name<input name="signedBy" required value="' + esc(j.name) + '"></label>' +
        '<p class="form-msg" hidden></p><div class="form-actions"><button class="btn" type="submit">Close Job with Signature</button>' +
        '<button class="btn btn-ghost" type="button" id="eng-cancel">Cancel Booking</button></div></form>';
    } else {
      h += '<p class="eng-actions no-print"><button class="btn" type="button" id="eng-pdf">Download PDF</button>' +
        '<a class="btn btn-wa" target="_blank" rel="noopener" href="' + esc(waText(j.phone, reportSummary(j))) + '">Send report on WhatsApp</a></p>';
    }
    body.innerHTML = engineerList() + h;
    if (flash) { var fl = document.createElement('p'); fl.className = 'form-msg ok-msg'; fl.textContent = flash; body.insertBefore(fl, body.firstChild.nextSibling); }
    if (!open) { $('#eng-pdf').addEventListener('click', function () { reportPdf(j); }); return; }

    var assign = $('#eng-assign'), close = $('#eng-close');
    assign.addEventListener('submit', function (e) {
      e.preventDefault();
      var m = $('.form-msg', assign), btn = $('button[type="submit"]', assign);
      var name = assign.elements.engineer.value.trim().replace(/\s+/g, ' '), visit = assign.elements.visitDate.value;
      if (!name) { setMsg(m, 'Type the engineer name first.', true); assign.elements.engineer.focus(); return; }
      rememberEngineer(name);
      btn.disabled = true; setMsg(m, 'Saving…');
      call('/' + j.id + '/assign', { method: 'POST', pin: pin, body: { engineer: name, visitDate: visit } })
        .then(function (res) {
          btn.disabled = false;
          // Read the job back so we only say "saved" when the Google Sheet really has the name
          if (!res.job || res.job.engineer !== name) {
            setMsg(m, 'The job server answered but did not store the engineer. Please send this screen to support.', true); return;
          }
          var at = jobs.findIndex(function (x) { return x.id === res.job.id; });
          if (at >= 0) jobs[at] = res.job;
          showJob(res.job, 'Saved. ' + name + ' is assigned to ' + res.job.id + (visit ? ' for ' + fmtDate(visit) : '') + '.');
          window.scrollTo(0, 0);
        }, function (err) {
          btn.disabled = false;
          setMsg(m, err.offline ? 'Not saved: the job server could not be reached. Check the internet and press Save Engineer again.' : 'Not saved: ' + err.message, true);
        });
    });
    $('#eng-cancel').addEventListener('click', function () {
      var reason = prompt('Reason for cancelling ' + j.id + '?');
      if (reason === null) return;
      call('/' + j.id + '/cancel', { method: 'POST', pin: pin, body: { reason: reason } }).then(function (res) { showJob(res.job); }, function (err) { alert(err.message); });
    });
    var pad = signaturePad($('#sig-pad'));
    $('#sig-clear').addEventListener('click', pad.clear);
    close.addEventListener('submit', function (e) {
      e.preventDefault();
      var m = $('.form-msg', close);
      if (pad.isEmpty()) { setMsg(m, 'The customer needs to sign before you close the job.', true); return; }
      var f = close.elements, data = { signature: pad.toDataURL() };
      ['engineer', 'workDone', 'parts', 'meter', 'charges', 'payment', 'remarks', 'signedBy'].forEach(function (k) { data[k] = f[k].value.trim(); });
      store.set('aim-engineer', data.engineer); rememberEngineer(data.engineer);
      var btn = $('button[type="submit"]', close);
      btn.disabled = true; setMsg(m, 'Saving…');
      call('/' + j.id + '/close', { method: 'POST', pin: pin, body: data }).then(function (res) { showJob(res.job, 'Job closed with the customer signature. Press Download PDF for the job sheet.'); window.scrollTo(0, 0); },
        function (err) { btn.disabled = false; setMsg(m, err.message, true); });
    });
  }

  // ---------- Job sheet on the phone (no server) ----------
  function jobSheet() {
    var KEY = 'aim-job-sheets';
    var load = function () { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
    var save = function (list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40))); } catch (e) {} };
    var me = function () { try { return localStorage.getItem('aim-engineer') || ''; } catch (e) { return ''; } };
    $('#eng-login').hidden = true; $('#eng-board').hidden = true;
    var det = $('#eng-detail'); det.hidden = false; $('#eng-back').parentNode.hidden = true;
    var body = $('#eng-job');
    var f = function (label, name, extra) { return '<label>' + label + '<input name="' + name + '" ' + (extra || '') + '></label>'; };
    function form() {
      var past = load();
      body.innerHTML = '<form class="form" id="sheet"><h2>Service Job Sheet</h2>' +
        '<p class="small">Fill this in at the customer\'s site. The customer signs on the screen, then save or send the signed report.</p>' +
        '<div class="form-row">' + f('Job number (from WhatsApp booking)', 'id', 'placeholder="Leave empty for a new number"') + f('Engineer', 'engineer', 'required value="' + esc(me()) + '"') + '</div>' +
        '<div class="form-row">' + f('Customer name', 'name', 'required') + f('Phone', 'phone', 'type="tel" inputmode="tel" required') + '</div>' +
        f('Office or Organisation', 'org') + '<label>Address<textarea name="address" rows="2"></textarea></label>' +
        '<div class="form-row">' + f('Machine model', 'model') + f('Serial no.', 'serial') + '</div>' +
        '<label>Problem reported<textarea name="problem" rows="2"></textarea></label>' +
        '<label>Work done<textarea name="workDone" rows="3" required placeholder="Fault found and what was fixed"></textarea></label>' +
        f('Parts replaced', 'parts') +
        '<div class="form-row">' + f('Meter reading', 'meter', 'inputmode="numeric"') + f('Charges (₹)', 'charges', 'inputmode="decimal"') + '</div>' +
        '<label>Payment<select name="payment"><option>Under warranty</option><option>Under AMC</option><option>Paid: cash</option><option>Paid: UPI</option><option>To be billed</option><option>No charge</option></select></label>' +
        f('Remarks', 'remarks') +
        '<fieldset class="sig"><legend>Customer signature</legend><canvas id="sig-pad" aria-label="Sign here"></canvas>' +
        '<div class="sig-bar"><span class="small">Ask the customer to sign above with a finger.</span><button type="button" class="btn btn-ghost" id="sig-clear">Clear</button></div></fieldset>' +
        f('Customer name (signed by)', 'signedBy', 'required') +
        '<p class="form-msg" hidden></p><div class="form-actions"><button class="btn" type="submit">Close Job with Signature</button></div></form>' +
        (past.length ? '<div><h2>Reports on this phone</h2><div class="job-list">' + past.map(function (j, i) {
          return '<button class="job-row" data-i="' + i + '"><span><b>' + esc(j.name) + '</b><br><span class="small">' + esc(j.id) + ' · ' + esc(fmtDate(j.closure.closedAt, true)) + '</span></span><span class="sr-status s-closed">Closed</span></button>';
        }).join('') + '</div></div>' : '');
      var sheet = $('#sheet');
      sheet.elements.name.addEventListener('input', function () { sheet.elements.signedBy.value = sheet.elements.name.value; });
      var pad = signaturePad($('#sig-pad'));
      $('#sig-clear').addEventListener('click', pad.clear);
      body.querySelectorAll('.job-row').forEach(function (b) { b.addEventListener('click', function () { show(load()[+b.dataset.i]); }); });
      sheet.addEventListener('submit', function (e) {
        e.preventDefault();
        var m = $('.form-msg', sheet), el = sheet.elements;
        if (pad.isEmpty()) { setMsg(m, 'The customer needs to sign before you close the job.', true); return; }
        var v = function (k) { return el[k].value.trim(); };
        var now = new Date().toISOString();
        var job = { id: (v('id') || newJobId()).toUpperCase(), status: 'Closed', createdAt: now, name: v('name'), org: v('org'), phone: v('phone'), address: v('address'),
          model: v('model'), serial: v('serial'), problem: v('problem'), engineer: v('engineer'),
          closure: { engineer: v('engineer'), workDone: v('workDone'), parts: v('parts'), meter: v('meter'), charges: v('charges'), payment: v('payment'),
            remarks: v('remarks'), signedBy: v('signedBy'), closedAt: now, signature: pad.toDataURL() } };
        try { localStorage.setItem('aim-engineer', job.engineer); } catch (err) {}
        save([job].concat(load()));
        show(job);
      });
    }
    function show(j) {
      body.innerHTML = '<div class="sr-report">' + reportHtml(j, true) + '</div>' +
        '<p class="eng-actions no-print"><button class="btn" type="button" id="share-img">Share signed report</button>' +
        '<a class="btn btn-wa" target="_blank" rel="noopener" href="' + esc(waText(j.phone, reportSummary(j))) + '">Send summary to customer</a>' +
        '<a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/' + esc(WA) + '?text=' + encodeURIComponent(reportSummary(j)) + '">Send to office</a>' +
        '<button class="btn btn-ghost" type="button" id="sheet-pdf">Download PDF</button>' +
        '<button class="btn btn-ghost" type="button" id="new-sheet">New Job Sheet</button></p>';
      $('#sheet-pdf').addEventListener('click', function () { reportPdf(j); });
      $('#new-sheet').addEventListener('click', function () { form(); window.scrollTo(0, 0); });
      $('#share-img').addEventListener('click', function () { reportImage(j); });
      window.scrollTo(0, 0);
    }
    form();
  }

  // Draws the signed report as a PNG and shares it (WhatsApp etc.), or downloads it
  function reportImage(j) {
    var c = j.closure || {}, W = 1000, pad = 48, lines = [];
    var rows = [['Job number', j.id], ['Date', fmtDate(c.closedAt, true)], ['Customer', j.name], ['Organisation', j.org], ['Phone', j.phone], ['Address', j.address],
      ['Machine', j.model], ['Serial no.', j.serial], ['Problem', j.problem], ['Engineer', c.engineer], ['Work done', c.workDone], ['Parts replaced', c.parts],
      ['Meter reading', c.meter], ['Charges', c.charges ? 'Rs ' + c.charges : ''], ['Payment', c.payment], ['Remarks', c.remarks]].filter(function (r) { return r[1]; });
    var cv = document.createElement('canvas'), x = cv.getContext('2d');
    x.font = '26px Arial';
    var wrap = function (text, width) {
      var out = [], line = '';
      String(text).split(/\s+/).forEach(function (w) { var t = line ? line + ' ' + w : w; if (x.measureText(t).width > width && line) { out.push(line); line = w; } else line = t; });
      out.push(line); return out;
    };
    rows.forEach(function (r) { var ls = wrap(r[1], W - pad * 2 - 260); lines.push([r[0], ls]); });
    var img = new Image();
    img.onload = function () {
    var sw = Math.min(420, img.width), sh = img.height * sw / img.width;
    var H = 210 + lines.reduce(function (h, l) { return h + l[1].length * 36 + 16; }, 0) + sh + 140;
    cv.width = W; cv.height = H;
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#e41920'; x.font = 'bold 40px Arial'; x.fillText('AIM ENTERPRISES', pad, 70);
    x.fillStyle = '#383838'; x.font = '22px Arial'; x.fillText('Canon Authorised Partner · Sri Vijaya Puram · +91 94342 82223', pad, 105);
    x.fillStyle = '#000'; x.font = 'bold 32px Arial'; x.fillText('Service Report', pad, 165);
    var y = 210;
    lines.forEach(function (l) {
      x.fillStyle = '#757575'; x.font = '24px Arial'; x.fillText(l[0], pad, y);
      x.fillStyle = '#000'; x.font = '26px Arial';
      l[1].forEach(function (t, k) { x.fillText(t, pad + 260, y + k * 36); });
      y += l[1].length * 36 + 16;
    });
      y += 10;
      x.drawImage(img, pad, y, sw, sh); y += sh + 8;
      x.strokeStyle = '#383838'; x.beginPath(); x.moveTo(pad, y); x.lineTo(pad + 420, y); x.stroke();
      x.fillStyle = '#000'; x.font = '26px Arial'; x.fillText('Customer signature: ' + (c.signedBy || ''), pad, y + 40);
      x.fillStyle = '#757575'; x.font = '22px Arial'; x.fillText('I confirm the above work was carried out to my satisfaction.', pad, y + 76);
      cv.toBlob(function (blob) {
        var file = new File([blob], j.id + '.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'Service Report ' + j.id, text: 'AIM Enterprises service report ' + j.id }).catch(function () {});
        } else {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
        }
      }, 'image/png');
    };
    img.src = c.signature;
  }

  // ---------- Service report PDF (A4 job sheet on the AIM letterhead) ----------
  var pdfLibs = null;
  function loadScript(src) {
    return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error('Could not load ' + src)); }; document.head.appendChild(s); });
  }
  function pdfReady() {
    if (!pdfLibs) {
      // Kept on our own site (assets/vendor) instead of an outside server
      pdfLibs = loadScript(HERE + 'vendor/jspdf.umd.min.js?v=2.5.1')
        .then(function () { return loadScript(HERE + 'vendor/jspdf.plugin.autotable.min.js?v=3.8.2'); })
        .catch(function (e) { pdfLibs = null; throw e; });
    }
    return pdfLibs;
  }
  function reportPdf(j) {
    var c = j.closure || {};
    return pdfReady().then(function () {
      var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
      var W = 210, M = 12, R = [228, 25, 32], G = [90, 90, 90], y = 12;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(R[0], R[1], R[2]); doc.text('AIM ENTERPRISES', M, y + 6);
      doc.setFontSize(8.5); doc.setTextColor(30, 30, 30); doc.text('Canon Authorized Premium Business Partner  |  Canon Service Edge (CSP)', M, y + 11);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(G[0], G[1], G[2]);
      ['Shop No. 3, Opp. BJP Bhawan, No. 112 Middle Point,', 'MG Road, Sri Vijaya Puram - 744101', 'Ph: +91 94342 82223, +91 3192 220900',
        'info@aimenterprises.net  |  GSTIN: 35AKEPP1123F1ZM'].forEach(function (t, i) { doc.text(t, W - M, y + i * 3.4, { align: 'right' }); });
      y += 14; doc.setDrawColor(R[0], R[1], R[2]); doc.setLineWidth(0.8); doc.line(M, y, W - M, y);
      y += 7; doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(0, 0, 0); doc.text('SERVICE REPORT / JOB SHEET', W / 2, y, { align: 'center' });
      y += 3;
      var head = { fillColor: R, textColor: 255, fontStyle: 'bold', fontSize: 8.5 };
      var base = { fontSize: 8.5, cellPadding: 1.6, lineColor: [170, 170, 170], lineWidth: 0.2, textColor: [20, 20, 20], valign: 'top' };
      var lab = { fontStyle: 'bold', fillColor: [243, 244, 246], cellWidth: 34 };
      var t = function (s) { return s == null ? '' : String(s); };
      var grid = function (title, rows) {
        doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: base, headStyles: head, head: [[{ content: title, colSpan: 4 }]],
          body: rows.map(function (r) { return [{ content: r[0], styles: lab }, t(r[1]), { content: r[2], styles: lab }, t(r[3])]; }) });
        y = doc.lastAutoTable.finalY + 3;
      };
      grid('CALL DETAILS', [['Job No.', j.id, 'Booked On', fmtDate(j.createdAt, true)], ['Status', j.status, 'Closed On', fmtDate(c.closedAt, true)],
        ['Preferred Visit', [fmtDate(j.preferredDate), j.slot].filter(Boolean).join(', '), 'Payment', c.payment]]);
      grid('CUSTOMER DETAILS', [['Customer', j.name, 'Organisation', j.org], ['Phone', j.phone, 'Email', j.email], ['Address', j.address, '', '']]);
      grid('MACHINE DETAILS', [['Model', j.model, 'Serial No.', j.serial], ['Meter Reading', c.meter, '', '']]);
      grid('ENGINEER VISIT', [['Engineer', c.engineer || j.engineer, 'Visit Date', fmtDate(j.visitDate)]]);
      doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'grid', styles: base, headStyles: head, bodyStyles: { minCellHeight: 9 },
        head: [[{ content: 'WORK DONE', colSpan: 2 }]],
        body: [[{ content: 'Problem Reported', styles: lab }, t(j.problem)], [{ content: 'Work Done', styles: lab }, t(c.workDone)],
          [{ content: 'Parts Replaced', styles: lab }, t(c.parts) || 'None'], [{ content: 'Charges (Rs.)', styles: lab }, t(c.charges) || '0'],
          [{ content: 'Remarks', styles: lab }, t(c.remarks)]] });
      y = doc.lastAutoTable.finalY + 5;
      if (y > 245) { doc.addPage(); y = 20; }
      var bw = (W - 2 * M - 8) / 2;
      doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.2); doc.rect(M, y, bw, 32); doc.rect(M + bw + 8, y, bw, 32);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(20, 20, 20);
      doc.text('For AIM ENTERPRISES', M + 2, y + 5); doc.text('Customer Signature & Office Seal', M + bw + 10, y + 5);
      if (c.signature) { try { doc.addImage(c.signature, 'PNG', M + bw + 10, y + 7, 56, 17); } catch (e) {} }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(G[0], G[1], G[2]);
      doc.text('Engineer: ' + t(c.engineer || j.engineer), M + 2, y + 28);
      doc.text('Name: ' + t(c.signedBy), M + bw + 10, y + 28);
      if (c.signedBy) doc.text('I confirm the above work was carried out to my satisfaction.', M + bw + 10, y + 31);
      var ph = doc.internal.pageSize.getHeight(), n = doc.getNumberOfPages();
      for (var i = 1; i <= n; i++) {
        doc.setPage(i); doc.setFontSize(7); doc.setTextColor(G[0], G[1], G[2]);
        doc.text('Computer-generated service report. Service calls: +91 94342 82223  |  Mon-Fri 9 am-6 pm, Sat 9 am-1 pm', W / 2, ph - 7, { align: 'center' });
      }
      var name = 'Service Report ' + j.id + (j.name ? ' ' + j.name : '');
      name = name.replace(/[^\w .-]+/g, '').slice(0, 80) + '.pdf';
      var blob = doc.output('blob'), file = new File([blob], name, { type: 'application/pdf' });
      if (navigator.canShare && /Android|iPhone|iPad/i.test(navigator.userAgent) && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: 'Service Report ' + j.id }).catch(function () { doc.save(name); });
      }
      doc.save(name);
    }).catch(function (e) { alert('Could not make the PDF. Check the internet connection and try again. (' + e.message + ')'); });
  }

  // Finger, stylus or mouse signature on a canvas; exported as a small white-background PNG
  function signaturePad(canvas) {
    var ctx = canvas.getContext('2d'), drawing = false, inked = false, last = null;
    function size() {
      var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      var keep = inked ? canvas.toDataURL() : null;
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
      if (keep) { var img = new Image(); img.onload = function () { ctx.drawImage(img, 0, 0, r.width, r.height); }; img.src = keep; }
    }
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    canvas.addEventListener('pointerdown', function (e) { e.preventDefault(); canvas.setPointerCapture(e.pointerId); drawing = true; last = pos(e); ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, 7); ctx.fillStyle = '#111'; ctx.fill(); inked = true; });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; inked = true;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { canvas.addEventListener(t, function () { drawing = false; }); });
    window.addEventListener('resize', size);
    size();
    return {
      clear: function () { ctx.clearRect(0, 0, canvas.width, canvas.height); inked = false; },
      isEmpty: function () { return !inked; },
      toDataURL: function () {
        var w = Math.min(600, canvas.width), h = Math.round(canvas.height * w / canvas.width);
        var out = document.createElement('canvas'); out.width = w; out.height = h;
        var o = out.getContext('2d'); o.fillStyle = '#fff'; o.fillRect(0, 0, w, h); o.drawImage(canvas, 0, 0, w, h);
        return out.toDataURL('image/png');
      },
    };
  }
})();
