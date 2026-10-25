/* global output */
output.bw = {
  equal: function(actual, expected, message) {
    output.local.check(JSON.stringify(actual) === JSON.stringify(expected), message);
  },
  watching: function(names) {
    const s = output.local.state().scenario;
    this.equal(s.watches, names, 'The primary account watches exactly the beers tapped in the lístek sheet.');
    output.local.check(s.locationSet === names.length > 0, 'The app stored a rounded watch location only while something is watched.');
  },
  tap: function(pub, beer) {
    output.local.request('/beer-tap', { account: 'second', pub: pub, beer: beer });
    output.local.request('/beer-watch-worker', {});
  },
  firstPush: function() {
    const s = output.local.state().scenario;
    this.equal(s.pushes, [{
      body: 'E2E Hlídaná 12° je na čepu E2E Třetí hospoda, 0,3 km, doplnil někdo z komunity před chvílí',
      kind: 'beer_on_tap',
      pub: 'E2E Třetí hospoda',
    }], 'Exactly one push about the watched beer newly on tap nearby was sent.');
    this.equal(s.deliveries, [{ account__nickname: 'E2EPivar', event__pub_name: 'E2E Třetí hospoda', event__product__name: 'E2E Hlídaná 12°' }], 'The primary account has exactly one recorded beer push.');
  },
  sameDay: function() {
    const s = output.local.state().scenario;
    this.equal(s.events, [
      { pub: 'E2E Třetí hospoda', beer: 'E2E Hlídaná 12°', contributor: 'E2EKamos', fannedOut: true },
      { pub: 'E2E U Testera', beer: 'E2E Druhá 11°', contributor: 'E2EKamos', fannedOut: true },
    ], 'Both new taps were processed by the worker.');
    output.local.check(s.pushes.length === 1 && s.deliveries.length === 1, 'The second new tap the same day sends no push.');
    const helped = output.local.observe('second', '/v1/beer-watches');
    output.local.check(helped.status === 200, 'The contributor reads their beer-watch summary.');
    this.equal(helped.body.helped.map(function(h) { return [h.product_name, h.helped_count]; }), [['E2E Hlídaná 12°', 1]], 'The contributor sees that the first entry helped one person and the second none.');
  },
};
