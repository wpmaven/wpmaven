/**
 * WPMaven Payments in the block checkout (2026-10-01). No fields: placing the
 * order sends the buyer to the order's pay page, where Stripe's Payment
 * Element takes the payment (webmaven-payments-checkout.js).
 */
(function () {
  var wc = window.wc || {};
  var registry = wc.wcBlocksRegistry;
  var element = window.wp && window.wp.element;
  if (!registry || !element) return;
  var settings = wc.wcSettings && wc.wcSettings.getSetting ? wc.wcSettings.getSetting('webmaven_payments_data', {}) : {};
  var decode = window.wp.htmlEntities && window.wp.htmlEntities.decodeEntities ? window.wp.htmlEntities.decodeEntities : function (s) { return s; };
  var el = element.createElement;
  var title = decode(settings.title || 'Card or wallet');
  var Content = function () {
    return el('p', null, decode(settings.description || ''));
  };
  registry.registerPaymentMethod({
    name: 'webmaven_payments',
    label: el('span', null, title),
    ariaLabel: title,
    content: el(Content),
    edit: el(Content),
    canMakePayment: function () { return true; },
    supports: { features: settings.supports || ['products'] }
  });
})();
