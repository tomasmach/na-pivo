/* global MAESTRO_CONTROL, output, http, json */
// Runs inside Maestro's documented GraalJS environment. HTTP stays on the host.
// Actual bearer and email-action tokens are held only by the Node controller.
if (!/^http:\/\/127\.0\.0\.1:1832[1-3]$/.test(MAESTRO_CONTROL)) throw new Error('Only the isolated local controller is allowed.');
output.local = {
  request: function (route, body) {
    const response = body === undefined ? http.get(MAESTRO_CONTROL + route) : http.post(MAESTRO_CONTROL + route, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Local control ' + route + ' returned ' + response.status);
    return json(response.body);
  },
  state: function () { return this.request('/state'); },
  reset: function (scenario) { return this.request('/reset', { scenario: scenario }); },
  offline: function () { return this.request('/offline', {}); },
  online: function () { return this.request('/online', {}); },
  observe: function (account, route, password) { return this.request('/observe', { account: account, route: route, password: password || 'original' }); },
  // Retry read-only assertions while an asynchronous app write reaches Django.
  // A failed assertion remains a failure after the bounded deadline.
  poll: function (assertion, timeoutMs) {
    const deadline = Date.now() + Math.min(Math.max(timeoutMs || 15000, 1000), 30000);
    while (true) {
      try { assertion(); return true; }
      catch (error) {
        if (Date.now() >= deadline) throw error;
        this.request('/wait', { milliseconds: 500 });
      }
    }
  },
  screenshot: function (name) { return this.request('/screenshot', { name: name }); },
  check: function (condition, description) { if (!condition) throw new Error(description); return true; }
};
