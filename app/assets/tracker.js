/**
 * WebMaven Analytics Tracker
 * Lightweight, privacy-first tracker. No cookies, no fingerprinting.
 * Shipped in the WPMaven plugin (assets/tracker.js) and configured by
 * window.wpmavenTracker, or served by the API with <script src="...?id={trackingId}" defer>.
 */
(function() {
  'use strict';

  // Respect Do Not Track
  if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;

  // Config: from the WPMaven plugin, which ships this file and says where
  // the counts go (window.wpmavenTracker), or from the script's own address
  // (?id=) when the API serves it.
  var trackingId, API_URL;
  var config = window.wpmavenTracker;
  if (config && config.id && config.collect) {
    trackingId = String(config.id);
    API_URL = String(config.collect);
  } else {
    var script = document.currentScript;
    if (!script) return;
    var params = new URL(script.src).searchParams;
    trackingId = params.get('id');
    if (!trackingId) return;
    API_URL = script.src.replace(/\/tracker\.js.*$/, '/collect');
  }
  // Never Math.random: getRandomValues works where randomUUID does not (http pages, older browsers).
  var sessionId = crypto.randomUUID ? crypto.randomUUID() : Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(16)), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
  var queue = [];
  var pageStart = performance.now();
  var maxScroll = 0;
  var utmParams = parseUtm();
  var flushTimer = null;

  // ── UTM parsing ──
  function parseUtm() {
    var sp = new URLSearchParams(location.search);
    return {
      source: sp.get('utm_source'),
      medium: sp.get('utm_medium'),
      campaign: sp.get('utm_campaign'),
      content: sp.get('utm_content'),
      term: sp.get('utm_term')
    };
  }

  // ── Queue & flush ──
  function enqueue(event) {
    queue.push(event);
    if (!flushTimer) flushTimer = setTimeout(flush, 5000);
  }

  // The batch is JSON sent as plain text. With a JSON content type the browser
  // first asks the API for permission (a preflight, with credentials for a
  // beacon), which the API does not give to a customer site: it was not sent.
  // Plain text is sent at once and needs no answer. The collector reads the JSON.
  var BODY_TYPE = 'text/plain;charset=UTF-8';

  function flush() {
    flushTimer = null;
    if (!queue.length) return;
    var payload = JSON.stringify({ trackingId: trackingId, sessionId: sessionId, events: queue.splice(0) });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API_URL, new Blob([payload], { type: BODY_TYPE }));
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', API_URL, true);
      xhr.setRequestHeader('Content-Type', BODY_TYPE);
      xhr.send(payload);
    }
  }

  // ── Pageview ──
  function trackPageview() {
    enqueue({
      type: 'pageview',
      url: location.pathname + location.search,
      title: document.title,
      referrer: document.referrer || null,
      screenWidth: screen.width,
      utm: utmParams.source ? utmParams : undefined
    });
  }

  // ── Scroll depth ──
  function onScroll() {
    var docHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    var viewHeight = window.innerHeight;
    if (docHeight <= viewHeight) { maxScroll = 100; return; }
    var pct = Math.round(((window.scrollY + viewHeight) / docHeight) * 100);
    if (pct > maxScroll) maxScroll = pct;
  }

  // ── Link clicks ──
  function onClick(e) {
    var a = e.target.closest('a[href]');
    if (!a) return;
    var href = a.href;
    if (!href || href.startsWith('javascript:') || href.startsWith('#')) return;

    try {
      var linkUrl = new URL(href, location.origin);

      // File downloads
      var ext = linkUrl.pathname.split('.').pop().toLowerCase();
      if (['pdf', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'].indexOf(ext) !== -1) {
        enqueue({ type: 'event', name: 'file_download', data: { url: href, ext: ext } });
        return;
      }

      // Outbound links
      if (linkUrl.hostname !== location.hostname) {
        enqueue({ type: 'event', name: 'outbound_click', data: { url: href, domain: linkUrl.hostname } });
        return;
      }

      // Internal links
      enqueue({ type: 'event', name: 'internal_click', data: { from: location.pathname, to: linkUrl.pathname } });
    } catch (_) {}
  }

  // ── data-wm-event attribute tracking ──
  function onClickWmEvent(e) {
    var el = e.target.closest('[data-wm-event]');
    if (!el) return;
    var name = el.getAttribute('data-wm-event');
    var data = el.getAttribute('data-wm-event-data');
    if (name) enqueue({ type: 'event', name: name, data: data ? JSON.parse(data) : undefined });
  }

  // ── Site search ──
  function trackSiteSearch() {
    var sp = new URLSearchParams(location.search);
    var query = sp.get('s'); // WordPress search parameter
    if (query) enqueue({ type: 'event', name: 'site_search', data: { query: query } });
  }

  // ── Core Web Vitals ──
  function trackWebVitals() {
    if (!('PerformanceObserver' in window)) return;

    // LCP
    try {
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        if (entries.length) enqueue({ type: 'vitals', lcp: entries[entries.length - 1].startTime });
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (_) {}

    // CLS
    try {
      var clsValue = 0;
      new PerformanceObserver(function(list) {
        list.getEntries().forEach(function(entry) {
          if (!entry.hadRecentInput) clsValue += entry.value;
        });
        enqueue({ type: 'vitals', cls: clsValue });
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (_) {}

    // INP
    try {
      var maxInp = 0;
      new PerformanceObserver(function(list) {
        list.getEntries().forEach(function(entry) {
          if (entry.duration > maxInp) maxInp = entry.duration;
        });
        enqueue({ type: 'vitals', inp: maxInp });
      }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
    } catch (_) {}
  }

  // ── WooCommerce auto-detection ──
  function trackWooCommerce() {
    // Product view (WC adds body class)
    if (document.body.classList.contains('single-product')) {
      var name = document.querySelector('.product_title');
      enqueue({ type: 'event', name: 'product_view', data: { product: name ? name.textContent.trim() : null, url: location.pathname } });
    }

    // Thank-you page (order received)
    if (document.body.classList.contains('woocommerce-order-received')) {
      enqueue({ type: 'event', name: 'purchase', data: { url: location.pathname } });
    }

    // Real order total (see trackOrder)
    trackOrder();

    // Add to cart (AJAX hook)
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.add_to_cart_button, .single_add_to_cart_button');
      if (btn) {
        var productName = document.querySelector('.product_title');
        enqueue({ type: 'event', name: 'add_to_cart', data: { product: productName ? productName.textContent.trim() : null } });
      }
    });
  }

  // ── WooCommerce order totals ──
  // Parse a formatted price ("$1,234.56", "1.234,56 €") into a number.
  // The decimal separator is whichever of . or , comes last; a lone
  // separator followed by exactly 3 digits is a thousands separator.
  function parseAmount(text) {
    if (!text) return null;
    var cleaned = text.replace(/[^0-9.,]/g, '');
    if (!cleaned) return null;
    var lastDot = cleaned.lastIndexOf('.');
    var lastComma = cleaned.lastIndexOf(',');
    var decimal = lastDot > lastComma ? '.' : lastComma > -1 ? ',' : null;
    if (decimal !== null && (lastDot === -1 || lastComma === -1)) {
      // Only one separator kind present. Repeated ("1,234,567"), or a single
      // one with exactly 3 trailing digits ("1.234"), means thousands.
      var idx = decimal === '.' ? lastDot : lastComma;
      if (cleaned.indexOf(decimal) !== idx || cleaned.length - idx - 1 === 3) decimal = null;
    }
    var normalized;
    if (decimal === ',') normalized = cleaned.replace(/\./g, '').replace(',', '.');
    else if (decimal === '.') normalized = cleaned.replace(/,/g, '');
    else normalized = cleaned.replace(/[.,]/g, '');
    var value = parseFloat(normalized);
    return isFinite(value) && value > 0 ? value : null;
  }

  // Capture the real order total on the WooCommerce thank-you page.
  // Prefers window.__wpmavenOrder (printed by the WPMaven plugin from the
  // real WC_Order); falls back to the order-received URL + DOM total.
  function trackOrder() {
    var ctx = window.__wpmavenOrder;
    var orderId = null;
    var total = null;
    var currency = null;

    if (ctx && ctx.id && typeof ctx.total === 'number' && isFinite(ctx.total) && ctx.total > 0) {
      orderId = String(ctx.id);
      total = ctx.total;
      currency = ctx.currency || null;
    } else {
      var pathMatch = location.pathname.match(/\/order-received\/(\d+)/);
      if (!pathMatch && location.search.indexOf('key=wc_order_') === -1) return;
      if (pathMatch) orderId = pathMatch[1];
      if (!orderId) {
        var idEl = document.querySelector('.woocommerce-order-overview__order strong');
        if (idEl) orderId = idEl.textContent.replace(/[^0-9]/g, '') || null;
      }
      var totalEl = document.querySelector('.woocommerce-order-overview__total .amount') ||
        document.querySelector('.woocommerce-order-overview__total');
      if (totalEl) total = parseAmount(totalEl.textContent);
    }

    if (!orderId || total === null) return;

    // Dedupe thank-you page refreshes. localStorage may be unavailable
    // (private mode); then we send anyway and the server dedupes by orderId.
    var dedupeKey = 'wm_order_' + orderId;
    try {
      if (localStorage.getItem(dedupeKey)) return;
      localStorage.setItem(dedupeKey, '1');
    } catch (_) {}

    enqueue({ type: 'order', orderId: orderId, total: total, currency: currency });
  }

  // ── Form submission auto-detection ──
  function trackFormSubmissions() {
    // CF7
    document.addEventListener('wpcf7mailsent', function(e) {
      enqueue({ type: 'event', name: 'form_submit', data: { plugin: 'cf7', formId: e.detail.contactFormId } });
    });

    // WPForms
    document.addEventListener('wpformsAjaxSubmitSuccess', function(e) {
      enqueue({ type: 'event', name: 'form_submit', data: { plugin: 'wpforms' } });
    });

    // Gravity Forms
    if (window.jQuery) {
      jQuery(document).on('gform_confirmation_loaded', function(e, formId) {
        enqueue({ type: 'event', name: 'form_submit', data: { plugin: 'gravity_forms', formId: formId } });
      });
    }
  }

  // ── Page unload ──
  function onUnload() {
    var timeOnPage = Math.round((performance.now() - pageStart) / 1000);
    enqueue({
      type: 'leave',
      timeOnPage: timeOnPage,
      scrollDepth: maxScroll
    });
    flush();
  }

  // ── Public API ──
  window.webmavenTracker = {
    event: function(name, data) {
      enqueue({ type: 'event', name: name, data: data || undefined });
    }
  };

  // ── Init ──
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('click', onClickWmEvent, true);
  document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') onUnload(); });
  window.addEventListener('beforeunload', onUnload);

  trackPageview();
  trackSiteSearch();
  trackWebVitals();
  trackWooCommerce();
  trackFormSubmissions();
})();
