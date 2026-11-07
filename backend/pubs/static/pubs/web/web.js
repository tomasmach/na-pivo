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

  // The mobile menu opens as #menu (works without this script); Escape closes it and returns to the button.
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || location.hash !== "#menu") return;
    var close = document.querySelector("[data-menu-close]");
    if (!close) return;
    close.click();
    var open = document.querySelector("[data-menu-open]");
    if (open) open.focus();
  });

  // A pub page counts its view and navigation taps; only the pub, the action and the referrer's origin go out.
  var reachPub = document.querySelector("[data-reach-pub]");
  if (reachPub && !navigator.webdriver) {
    var referrer = "";
    // Scheme and host only; the Google app on Android refers as android-app://com.google..., whose origin is "null".
    try { var from = new URL(document.referrer); referrer = from.protocol + "//" + from.host; } catch (e) { referrer = ""; }
    var reach = function (type) {
      var body = JSON.stringify({ pub: reachPub.getAttribute("data-reach-pub"), type: type, ref: referrer });
      try {
        if (navigator.sendBeacon && navigator.sendBeacon("/web/reach", new Blob([body], { type: "application/json" }))) return;
        fetch("/web/reach", { method: "POST", body: body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(function () {});
      } catch (e) {
        // Counting must never break the page.
      }
    };
    var viewed = function () { reach("detail_view"); };
    // A page the browser prerenders counts once somebody actually opens it.
    if (document.prerendering) document.addEventListener("prerenderingchange", viewed, { once: true });
    else viewed();
    document.querySelectorAll('[data-reach="navigation"]').forEach(function (link) {
      link.addEventListener("click", function () { reach("navigation"); });
    });
  }

  // "Načíst další" is a link to the next page of the list; here it appends that page instead of leaving.
  document.addEventListener("click", async function (event) {
    var link = event.target.closest && event.target.closest("a[data-more]");
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var rows = document.querySelector("[data-more-rows]");
    var foot = document.querySelector("[data-more-foot]");
    if (!rows || !foot) return;
    event.preventDefault();
    if (link.getAttribute("aria-busy")) return;
    link.setAttribute("aria-busy", "true");
    try {
      var response = await fetch(link.href.split("#")[0], { credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      var next = new DOMParser().parseFromString(await response.text(), "text/html");
      var nextRows = next.querySelector("[data-more-rows]");
      var nextFoot = next.querySelector("[data-more-foot]");
      if (!nextRows || !nextFoot) throw new Error("no list");
      var first = nextRows.firstElementChild;
      rows.append.apply(rows, Array.from(nextRows.children));
      foot.replaceChildren.apply(foot, Array.from(nextFoot.childNodes));
      // The next page's foot counts only its own rows; with them appended the list runs from its first row on.
      var count = foot.querySelector("[data-count]");
      var row = function (element) { var anchor = element && (element.id ? element : element.querySelector("[id^='h']")); return anchor ? Number(anchor.id.slice(1)) : 0; };
      var from = row(rows.firstElementChild), to = row(rows.lastElementChild);
      if (count && from && to) {
        var lang = document.documentElement.lang;
        count.textContent = (from === 1 ? count.dataset.fromStart : count.dataset.range)
          .replace("{first}", from.toLocaleString(lang)).replace("{last}", to.toLocaleString(lang));
      }
      // A pub list row is a link or holds one; the focus goes where the keyboard can carry on.
      var focusable = first && (first.matches("a") ? first : first.querySelector("a"));
      if (focusable) focusable.focus({ preventScroll: true });
    } catch (e) {
      location.href = link.href;
    }
  });

  // The return page of Google and Apple sign-in posts itself on.
  var form = document.querySelector("form[data-autosubmit]");
  if (form) form.submit();
})();
