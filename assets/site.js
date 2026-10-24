// Mobile menu, catalogue filters, and quote/service forms (sent via WhatsApp or email; no server needed).
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open);
    });
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

  // Forms: pre-fill model from ?model=, then send through WhatsApp or email
  var params = new URLSearchParams(location.search);
  document.querySelectorAll('form.form').forEach(function (form) {
    if (params.get('model') && form.elements.model) form.elements.model.value = params.get('model');
    var via = 'whatsapp';
    form.querySelectorAll('button[data-via]').forEach(function (b) {
      b.addEventListener('click', function () { via = b.dataset.via; });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var kind = form.dataset.kind === 'service' ? 'Service request' : 'Quotation request';
      var lines = [kind + ' from website'];
      [['Name', 'name'], ['Organisation', 'org'], ['Phone', 'phone'], ['Email', 'email'], ['Model', 'model'], ['Quantity', 'qty'], ['Message', 'message']]
        .forEach(function (pair) { if (f[pair[1]] && f[pair[1]].value.trim()) lines.push(pair[0] + ': ' + f[pair[1]].value.trim()); });
      var text = lines.join('\n');
      if (via === 'email') {
        location.href = 'mailto:' + document.body.dataset.email + '?subject=' + encodeURIComponent(kind) + '&body=' + encodeURIComponent(text);
      } else {
        window.open('https://wa.me/' + document.body.dataset.wa + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
      }
    });
  });
})();
