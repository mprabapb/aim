// Mobile menu, catalogue filters, and the quotation form (sent via WhatsApp, or by email through the Apps Script server).
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
  }

  // Call Us: phones dial the main mobile straight away; computers (no dialer) get a list of all AIM numbers
  var callBtn = document.querySelector('.bar-accent');
  var callPop = document.querySelector('.call-pop');
  if (callBtn && callPop) {
    var canDial = function () {
      return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    };
    var setPop = function (open) {
      callPop.hidden = !open;
      callBtn.setAttribute('aria-expanded', open);
    };
    callBtn.addEventListener('click', function (e) {
      if (canDial()) return;
      e.preventDefault();
      setPop(callPop.hidden);
    });
    document.addEventListener('click', function (e) {
      if (!callPop.hidden && !callPop.contains(e.target) && !callBtn.contains(e.target)) setPop(false);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setPop(false); });
  }

  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Home banners: rotate every 6 seconds like Canon's carousel; the dots jump to a banner
  var slides = document.querySelectorAll('.banner .slide');
  var ticks = document.querySelectorAll('.banner .reel-tick');
  if (slides.length > 1) {
    var cur = 0;
    var show = function (n) {
      slides[cur].classList.remove('is-on');
      ticks[cur].classList.remove('is-on');
      cur = n % slides.length;
      slides[cur].classList.add('is-on');
      ticks[cur].classList.add('is-on');
    };
    var timer = still ? null : setInterval(function () { if (!document.hidden) show(cur + 1); }, 6000);
    ticks.forEach(function (t, i) {
      t.addEventListener('click', function () { clearInterval(timer); show(i); });
    });
  }

  // Sections below the fold rise in as they enter view; anything already on screen stays put
  if ('IntersectionObserver' in window && !still) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.remove('pre'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach(function (el) {
      if (el.getBoundingClientRect().top > window.innerHeight) { el.classList.add('pre'); io.observe(el); }
    });
  }

  // Desktop mega menu under "Products"
  var header = document.querySelector('.site-header');
  var prodLink = nav && nav.querySelector('a[href$="products/index.html"]');
  if (header && prodLink) {
    var openMega = function () { header.classList.add('mega-open'); };
    prodLink.addEventListener('mouseenter', openMega);
    prodLink.addEventListener('focus', openMega);
    header.addEventListener('mouseleave', function () { header.classList.remove('mega-open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') header.classList.remove('mega-open'); });
  }

  // Catalogue: category chips + search box
  var q = document.getElementById('q');
  var chips = document.querySelectorAll('.chip');
  if (q && chips.length) {
    var current = 'all';
    var apply = function () {
      var term = q.value.trim().toLowerCase();
      var shown = 0;
      document.querySelectorAll('.cat-block').forEach(function (block) {
        var inCat = current === 'all' || block.dataset.cat === current;
        var visible = 0;
        block.querySelectorAll('.card').forEach(function (card) {
          var ok = inCat && (!term || card.dataset.name.indexOf(term) !== -1);
          card.hidden = !ok;
          if (ok) visible++;
        });
        block.hidden = visible === 0;
        shown += visible;
      });
      document.querySelector('.empty').hidden = shown !== 0;
    };
    var select = function (cat) {
      current = cat;
      chips.forEach(function (c) { c.setAttribute('aria-pressed', c.dataset.filter === cat); });
      apply();
    };
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        select(c.dataset.filter);
        history.replaceState(null, '', c.dataset.filter === 'all' ? location.pathname : '#' + c.dataset.filter);
      });
    });
    q.addEventListener('input', apply);
    var hash = location.hash.slice(1);
    if (hash === 'search') q.focus();
    if (hash && document.querySelector('.chip[data-filter="' + hash + '"]')) select(hash);
  }

  // Forms: pre-fill model from ?model=, then send through WhatsApp, or by email through the
  // website's Apps Script server (it emails AIM directly, so no mail app is needed on the visitor's device)
  var params = new URLSearchParams(location.search);
  var API = (document.body.dataset.api || '').split(',').map(function (b) { return b.trim(); })
    .filter(function (b) { return /script\.google(usercontent)?\.com/.test(b); })[0] || '';
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  document.querySelectorAll('form.form').forEach(function (form) {
    if (form.hasAttribute('data-online')) return; // handled by service.js
    if (params.get('model') && form.elements.model) form.elements.model.value = params.get('model');
    var started = Date.now(), via = 'whatsapp', busy = false;
    var msg = form.querySelector('.form-msg');
    form.querySelectorAll('button[data-via]').forEach(function (b) {
      b.addEventListener('click', function () { via = b.dataset.via; });
    });
    function say(html, cls) { if (msg) { msg.className = 'form-msg' + (cls ? ' ' + cls : ''); msg.innerHTML = html; msg.hidden = false; } }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      var f = form.elements;
      var kind = form.dataset.kind === 'service' ? 'Service request' : 'Quotation request';
      var lines = [kind + ' from website'];
      [['Name', 'name'], ['Organisation', 'org'], ['Phone', 'phone'], ['Email', 'email'], ['Model', 'model'], ['Quantity', 'qty'], ['Message', 'message']]
        .forEach(function (pair) { if (f[pair[1]] && f[pair[1]].value.trim()) lines.push(pair[0] + ': ' + f[pair[1]].value.trim()); });
      var text = lines.join('\n');
      var waUrl = 'https://wa.me/' + document.body.dataset.wa + '?text=' + encodeURIComponent(text);
      if (via !== 'email') { window.open(waUrl, '_blank', 'noopener'); return; }

      var mail = document.body.dataset.email;
      var mailUrl = 'mailto:' + mail + '?subject=' + encodeURIComponent(kind) + '&body=' + encodeURIComponent(text);
      function fallback(why) {
        // Could not send from the website: give the visitor ways that always work
        say((why ? esc(why) + ' ' : '') + 'Please send it one of these ways:' +
          '<span class="form-alt"><a class="btn btn-wa" href="' + esc(waUrl) + '" target="_blank" rel="noopener">Send on WhatsApp</a>' +
          '<a class="btn btn-ghost" href="' + esc(mailUrl) + '">Open my email app</a>' +
          '<button class="btn btn-ghost" type="button" data-copy>Copy enquiry</button></span>' +
          'Or email us at <a href="mailto:' + esc(mail) + '">' + esc(mail) + '</a>.', 'bad');
        var c = msg && msg.querySelector('[data-copy]');
        if (c) c.addEventListener('click', function () {
          (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () {
            c.textContent = 'Copied. Paste it in your email.';
          }, function () { c.textContent = 'Copy failed. Please use WhatsApp.'; });
        });
      }
      if (!API) { fallback(''); return; }
      var data = { action: 'enquiry', kind: kind, page: location.href.slice(0, 200), took: Date.now() - started };
      ['name', 'org', 'phone', 'email', 'model', 'qty', 'message', 'website'].forEach(function (n) { if (f[n]) data[n] = f[n].value.trim(); });
      var btns = form.querySelectorAll('button[data-via]');
      busy = true; btns.forEach(function (b) { b.disabled = true; });
      say('Sending your enquiry…');
      var ctl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 25000);
      fetch(API, { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'text/plain' }, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.ok) {
            say('<b>Thank you, ' + esc(data.name) + '.</b> Your enquiry has been sent to AIM Enterprises. We will call you on <b>' + esc(data.phone) + '</b> within one working day.', 'ok-msg');
            form.querySelectorAll('input:not([name="qty"]):not([name="website"]), textarea').forEach(function (i) { i.value = ''; });
          } else if (res && res.error && res.status !== 401 && res.status !== 500) {
            say(esc(res.error), 'bad');  // something to fix in the form, e.g. the phone number
          } else {
            fallback('Sorry, the enquiry could not be sent from the website just now.');
          }
        })
        .catch(function () { fallback('Sorry, the enquiry could not be sent from the website just now.'); })
        .then(function () { clearTimeout(timer); busy = false; btns.forEach(function (b) { b.disabled = false; }); });
    });
  });
})();
