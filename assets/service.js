// Online service booking, booking status check and the engineer job page.
// Talks to the jobs API (netlify/functions/jobs.mjs). Where the API is not reachable
// (for example on the GitHub Pages copy), booking falls back to WhatsApp.
(function () {
  var API = (document.body.dataset.api || '').replace(/\/$/, '') + '/api/jobs';
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
    var headers = { 'content-type': 'application/json' };
    if (opts.pin) headers['x-staff-pin'] = opts.pin;
    return fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        var type = r.headers.get('content-type') || '';
        if (type.indexOf('application/json') === -1) { var e = new Error('offline'); e.offline = true; throw e; }
        return r.json().then(function (data) {
          if (!r.ok) { var err = new Error(data.error || 'Something went wrong.'); err.status = r.status; throw err; }
          return data;
        });
      }, function () { var e = new Error('offline'); e.offline = true; throw e; });
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
      c.signedBy ? 'Signed by: ' + c.signedBy : '', 'Check status: ' + location.origin + location.pathname.replace(/[^/]*$/, '') + 'service.html#track']
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
      if (via === 'whatsapp') { window.open(waFallback(data), '_blank', 'noopener'); return; }
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
  if (track) {
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
  var store = { get: function (k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var pin = '';
  try { pin = sessionStorage.getItem('aim-pin') || ''; } catch (e) {}
  var jobs = [];
  var filter = 'open';
  var login = $('#eng-login'), board = $('#eng-board'), list = $('#eng-list'), detail = $('#eng-detail');
  var loginMsg = $('.form-msg', login);

  function badge(s) { return '<span class="sr-status s-' + esc(s.toLowerCase()) + '">' + esc(s) + '</span>'; }
  function renderList() {
    var shown = jobs.filter(function (j) { return filter === 'all' || (filter === 'open' ? j.status === 'Booked' || j.status === 'Assigned' : j.status === filter); });
    $('#eng-count').textContent = jobs.filter(function (j) { return j.status === 'Booked' || j.status === 'Assigned'; }).length + ' open';
    list.innerHTML = shown.length ? shown.map(function (j) {
      return '<button class="job-row" data-id="' + esc(j.id) + '"><span><b>' + esc(j.name) + '</b>' + (j.org ? ' · ' + esc(j.org) : '') +
        '<br><span class="small">' + esc(j.id) + ' · ' + esc(j.model || 'Model not given') + ' · ' + esc(fmtDate(j.preferredDate || j.createdAt)) + (j.engineer ? ' · ' + esc(j.engineer) : '') + '</span></span>' + badge(j.status) + '</button>';
    }).join('') : '<p class="small">No jobs here.</p>';
  }
  function load() {
    return call('', { pin: pin }).then(function (res) { jobs = res.jobs; renderList(); });
  }
  function enter() {
    setMsg(loginMsg, 'Checking…');
    load().then(function () {
      try { sessionStorage.setItem('aim-pin', pin); } catch (e) {}
      login.hidden = true; board.hidden = false; setMsg(loginMsg, '');
    }, function (err) {
      pin = ''; login.hidden = false; board.hidden = true;
      setMsg(loginMsg, err.offline ? 'The job server is not reachable from this address. Open the engineer page on the Netlify site.' : err.message, true);
    });
  }
  login.addEventListener('submit', function (e) { e.preventDefault(); pin = login.elements.pin.value; enter(); });
  if (pin) enter();
  $('#eng-logout').addEventListener('click', function () { try { sessionStorage.removeItem('aim-pin'); } catch (e) {} location.reload(); });
  $('#eng-refresh').addEventListener('click', function () { load(); });
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

  function showJob(j) {
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
        '<label>Engineer<input name="engineer" required value="' + esc(j.engineer || me) + '"></label>' +
        '<label>Visit date<input name="visitDate" type="date" value="' + esc(j.visitDate || j.preferredDate || '') + '"></label></div>' +
        '<p class="form-msg" hidden></p><div class="form-actions"><button class="btn btn-ghost" type="submit">Save</button></div></form>' +
        '<form class="form" id="eng-close"><h2>Close Job</h2>' +
        '<label>Engineer<input name="engineer" required value="' + esc(j.engineer || me) + '"></label>' +
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
      h += '<p class="eng-actions no-print"><button class="btn" type="button" onclick="print()">Print or save as PDF</button>' +
        '<a class="btn btn-wa" target="_blank" rel="noopener" href="' + esc(waText(j.phone, reportSummary(j))) + '">Send report on WhatsApp</a></p>';
    }
    body.innerHTML = h;
    if (!open) return;

    var assign = $('#eng-assign'), close = $('#eng-close');
    assign.addEventListener('submit', function (e) {
      e.preventDefault();
      var m = $('.form-msg', assign);
      store.set('aim-engineer', assign.elements.engineer.value.trim());
      call('/' + j.id + '/assign', { method: 'POST', pin: pin, body: { engineer: assign.elements.engineer.value, visitDate: assign.elements.visitDate.value } })
        .then(function (res) { showJob(res.job); }, function (err) { setMsg(m, err.message, true); });
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
      store.set('aim-engineer', data.engineer);
      var btn = $('button[type="submit"]', close);
      btn.disabled = true; setMsg(m, 'Saving…');
      call('/' + j.id + '/close', { method: 'POST', pin: pin, body: data }).then(function (res) { showJob(res.job); window.scrollTo(0, 0); },
        function (err) { btn.disabled = false; setMsg(m, err.message, true); });
    });
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
