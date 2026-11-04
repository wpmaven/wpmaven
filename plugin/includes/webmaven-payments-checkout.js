/**
 * WPMaven Payments in the buyer's browser (2026-10-01).
 *
 * The pay page ([data-wm-pay]): mounts Stripe's Payment Element with the
 * order's client secret and the platform's publishable key, and confirms on
 * "Pay now". The payment usually lives on the platform (made for the
 * business); for a business that linked the Stripe account it already had,
 * it lives on that account, and the API names it (data-stripe-account).
 * Stripe then returns the buyer to the order-received page. Nothing here
 * marks the order paid.
 *
 * The order-received page ([data-wm-pay-status]): polls the order's status
 * until the API has marked it paid (or failed), then reloads.
 */
(function () {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  function payPage(box) {
    var button = box.querySelector('.wm-pay__submit');
    var error = box.querySelector('.wm-pay__error');
    function show(message) {
      error.textContent = message || 'Your payment did not go through. Please try again.';
      error.hidden = false;
    }
    if (typeof window.Stripe !== 'function') {
      show('The payment form could not load. Please refresh the page.');
      return;
    }
    var account = box.getAttribute('data-stripe-account');
    var stripe = account
      ? window.Stripe(box.getAttribute('data-publishable-key'), { stripeAccount: account })
      : window.Stripe(box.getAttribute('data-publishable-key'));
    var elements = stripe.elements({ clientSecret: box.getAttribute('data-client-secret') });
    var payment = elements.create('payment', { layout: 'tabs' });
    payment.mount(box.querySelector('.wm-pay__element'));
    payment.on('ready', function () { button.disabled = false; });
    button.addEventListener('click', function () {
      button.disabled = true;
      error.hidden = true;
      stripe.confirmPayment({
        elements: elements,
        confirmParams: { return_url: box.getAttribute('data-return-url') }
      }).then(function (result) {
        // Only reached when the payment could not be confirmed; a success leaves the page.
        if (result && result.error) show(result.error.message);
        button.disabled = false;
      });
    });
  }

  function statusPage(box) {
    var url = box.getAttribute('data-wm-pay-status');
    var detail = box.querySelector('.wm-pay-confirming__detail');
    var tries = 0;
    function poll() {
      tries += 1;
      fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (s) {
          if (s && (s.paid || s.failed)) {
            window.location.reload();
            return;
          }
          if (tries < 60) {
            setTimeout(poll, tries < 10 ? 2000 : 5000);
          } else if (detail) {
            detail.textContent = 'This is taking longer than usual. We will email you as soon as your payment is confirmed.';
          }
        })
        .catch(function () {
          if (tries < 60) setTimeout(poll, 5000);
        });
    }
    setTimeout(poll, 1500);
  }

  ready(function () {
    var pay = document.querySelector('[data-wm-pay]');
    if (pay) payPage(pay);
    var status = document.querySelector('[data-wm-pay-status]');
    if (status) statusPage(status);
  });
})();
