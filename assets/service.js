// Online service booking, booking status check and the engineer job page.
// Talks to the jobs API: a Google Apps Script web app (google-apps-script/Code.gs) or
// netlify/functions/jobs.mjs. Where the API is not reachable
// (for example on the GitHub Pages copy), booking falls back to WhatsApp.
(function () {
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
      if (path === '/staff-pin') b.action = 'setpin';
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
        out.innerHTML = reportHtml(res.job, false) + '<p class="no-print"><button class="btn btn-ghost" type="button" onclick="print()">Print or save as PDF</button></p>';
        out.hidden = false;
      }, function (err) { setMsg(trackMsg, err.offline ? 'Status check is not available right now. Please call or WhatsApp us.' : err.message, true); });
    });
  }

  // ---------- Engineer page ----------
  var app = document.getElementById('engineer-app');
  if (!app) return;
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
    }, function (err) {
      pin = ''; login.hidden = false; board.hidden = true;
      if (err.data && err.data.setup) {
        showSetup(true);
        setMsg(loginMsg, 'No staff PIN has been set yet. Choose one now (at least 4 characters). Engineers will use it to sign in.');
        return;
      }
      setMsg(loginMsg, err.offline ? 'The job server is not reachable. Details for support: ' + (apiTried.join(' | ') || 'no server tried') : err.message, true);
    });
  }
  login.addEventListener('submit', function (e) {
    e.preventDefault();
    pin = login.elements.pin.value;
    if (!setupMode) { enter(); return; }
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
      pdfLibs = loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
        .then(function () { return loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'); })
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
