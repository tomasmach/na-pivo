// Small helpers of the Na pivo web. No framework, no third-party code.
(function () {
  "use strict";

  // Call a /v1/ endpoint as the signed-in web user: the session cookie goes along,
  // unsafe methods carry the CSRF token from <meta name="csrf-token">. Never throws.
  // Returns {ok, status, data}; status 0 means the network failed.
  window.npApi = async function npApi(path, options) {
    var opts = options || {};
    var method = (opts.method || "GET").toUpperCase();
    var headers = { Accept: "application/json", "Accept-Language": document.documentElement.lang || "cs" };
    if (method !== "GET" && method !== "HEAD") {
      var meta = document.querySelector('meta[name="csrf-token"]');
      if (meta) headers["X-CSRFToken"] = meta.content;
    }
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    try {
      var response = await fetch(path, init);
      var data = null;
      try { data = await response.json(); } catch (e) { data = null; }
      return { ok: response.ok, status: response.status, data: data };
    } catch (e) {
      return { ok: false, status: 0, data: null };
    }
  };

  // The return page of Google and Apple sign-in posts itself on.
  var form = document.querySelector("form[data-autosubmit]");
  if (form) form.submit();
})();
