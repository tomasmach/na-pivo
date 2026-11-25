// Signed-in pages of the web: every write is a /v1/ call, the same one the app makes.
(function () {
  "use strict";

  var root = document.getElementById("npa");
  if (!root) return;
  var UGC_HEADER = "X-Na-Pivo-UGC-Policy-Version";
  var text = JSON.parse(document.getElementById("npa-text").textContent);

  function csrf() {
    var meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : "";
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // Like npApi, plus the UGC policy header for shared content and a multipart body.
  async function call(path, opts) {
    var headers = { Accept: "application/json", "Accept-Language": document.documentElement.lang || "cs", "X-CSRFToken": csrf() };
    if (opts.ugc) headers[UGC_HEADER] = root.dataset.ugcVersion;
    Object.assign(headers, opts.headers || {});
    var init = { method: opts.method || "GET", headers: headers, credentials: "same-origin" };
    if (opts.form) init.body = opts.form;
    else if (opts.body !== undefined) {
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
  }

  function message(result) {
    if (result.status === 0) return text.offline;
    if (result.status === 429) return text.tooMany;
    var d = result.data;
    if (d && typeof d.detail === "string" && d.detail) return d.detail;
    if (d && typeof d === "object") {
      for (var key in d) {
        var v = d[key];
        if (Array.isArray(v) && typeof v[0] === "string") return v[0];
      }
    }
    return text.failed;
  }

  // A shared write without accepted rules answers 428; ask once, store the consent, try again.
  var consent = document.getElementById("npa-consent");
  function askConsent() {
    return new Promise(function (resolve) {
      if (!consent) return resolve(false);
      consent.returnValue = "";
      consent.showModal();
      consent.addEventListener("close", function done() {
        consent.removeEventListener("close", done);
        if (consent.returnValue !== "yes") return resolve(false);
        call("/v1/account/me/ugc-consent", { method: "PUT", body: { version: root.dataset.ugcVersion } })
          .then(function (r) { resolve(r.ok); });
      });
    });
  }

  async function send(path, opts) {
    var result = await call(path, opts);
    if (result.status === 428 && opts.ugc && (await askConsent())) result = await call(path, opts);
    return result;
  }

  function showError(scope, msg) {
    var box = scope && scope.querySelector("[data-error]");
    if (!box) { if (msg) window.alert(msg); return; }
    box.textContent = msg || "";
    box.hidden = !msg;
  }

  function busy(el, on) {
    el.toggleAttribute("aria-busy", on);
    el.querySelectorAll("button").forEach(function (b) { b.disabled = on; });
    if (el.tagName === "BUTTON") el.disabled = on;
  }

  // Buttons and forms with data-api: body from data-body or the form fields, then reload or go.
  function bodyOf(el) {
    if (el.dataset.body) return JSON.parse(el.dataset.body);
    if (el.tagName !== "FORM") return undefined;
    var out = {};
    Array.prototype.forEach.call(el.elements, function (f) {
      if (!f.name || f.disabled) return;
      if (f.type === "checkbox") out[f.name] = f.checked;
      else if (f.type === "radio") { if (f.checked) out[f.name] = f.value; }
      else out[f.name] = f.value.trim();
    });
    return out;
  }

  async function run(el) {
    if (el.hasAttribute("aria-busy")) return;
    if (el.dataset.confirm && !window.confirm(el.dataset.confirm)) return;
    var scope = el.closest("[data-scope]") || el;
    busy(el, true);
    showError(scope, "");
    var result = await send(el.dataset.api, { method: el.dataset.method || "POST", body: bodyOf(el), ugc: "ugc" in el.dataset });
    busy(el, false);
    if (!result.ok) return showError(scope, message(result));
    if (el.dataset.done) {
      // Assigning the address the page already has would only scroll, not show the saved state.
      var target = new URL(el.dataset.done, window.location.href).href;
      if (target === window.location.href) window.location.reload();
      else window.location.assign(target);
    }
    else if (el.dataset.ok) { showError(scope, ""); var ok = scope.querySelector("[data-ok-text]"); if (ok) { ok.textContent = el.dataset.ok; ok.hidden = false; } }
    else window.location.reload();
  }

  document.addEventListener("submit", function (e) {
    var form = e.target.closest("form[data-api]");
    if (!form) return;
    e.preventDefault();
    run(form);
  });

  document.addEventListener("click", function (e) {
    var el = e.target.closest("button[data-api]");
    if (el && !el.form) { e.preventDefault(); run(el); return; }
    var copy = e.target.closest("[data-copy]");
    if (copy) {
      var input = document.getElementById(copy.dataset.copy);
      navigator.clipboard.writeText(input.value).then(function () {
        copy.querySelector("span").textContent = text.copied;
      }, function () { input.select(); });
      return;
    }
    var opener = e.target.closest("[data-dialog]");
    if (opener) { e.preventDefault(); openDialog(opener); }
  });

  // Toggles save on change and flip back when the server says no.
  // Radios stay enabled so arrow keys keep focus; a short pause saves only the choice the user stops on.
  // Radio saves go one after another, so the server and the last saved value always follow click order.
  document.addEventListener("change", function (e) {
    var input = e.target.closest("input[data-toggle]");
    if (!input) return;
    var scope = input.closest("[data-scope]");
    if (input.type !== "radio") return save(input, scope);
    var change = scope.changes = (scope.changes || 0) + 1;
    clearTimeout(scope.saveTimer);
    scope.saveTimer = setTimeout(function () {
      var run = function () { return save(input, scope, change); };
      scope.saving = (scope.saving || Promise.resolve()).then(run, run);
    }, 400);
  });
  async function save(input, scope, change) {
    var value = input.type === "checkbox" ? input.checked : input.value;
    var body = {};
    body[input.name] = value;
    if (input.type === "checkbox") input.disabled = true;
    var result = await send(input.dataset.toggle, { method: "PATCH", body: body, ugc: "ugc" in input.dataset && value === true });
    input.disabled = false;
    if (input.type === "radio" && result.ok) scope.dataset.saved = value;
    // An older radio save must not touch the UI after the user picked something newer.
    if (input.type === "radio" && scope.changes !== change) return;
    if (result.ok) return showError(scope, "");
    if (input.type === "checkbox") input.checked = !value;
    else scope.querySelector('input[value="' + scope.dataset.saved + '"]').checked = true;
    showError(scope, message(result));
  }
  document.querySelectorAll("input[type=radio][data-toggle]:checked").forEach(function (r) { r.closest("[data-scope]").dataset.saved = r.value; });

  // Výčep: a round for somebody else's night, on and off.
  document.querySelectorAll("[data-round]").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var on = btn.getAttribute("aria-pressed") !== "true";
      btn.disabled = true;
      var result = await call("/v1/nights/" + btn.dataset.round + "/react", { method: on ? "POST" : "DELETE" });
      btn.disabled = false;
      if (!result.ok) return window.alert(message(result));
      btn.setAttribute("aria-pressed", String(result.data.my_round));
      btn.querySelector("[data-count]").textContent = result.data.rounds;
    });
  });

  // In one column the picked beer or pub sits below its list, so bring it into view.
  var picked = document.querySelector("[data-picked]");
  if (picked && new RegExp("[?&]" + picked.dataset.picked + "=").test(location.search) &&
      window.matchMedia("(max-width: 1180px)").matches) picked.scrollIntoView();

  // --- dialogs -------------------------------------------------------------
  function openDialog(opener) {
    var dialog = document.getElementById(opener.dataset.dialog);
    if (!dialog) return;
    if (dialog.id === "npa-rate") fillRating(dialog, opener.dataset.entry);
    showError(dialog, "");
    dialog.showModal();
  }
  document.querySelectorAll("dialog [data-close]").forEach(function (b) {
    b.addEventListener("click", function () { b.closest("dialog").close(); });
  });

  // Rating: the same check-in the app writes (beerCheckInWire), rewriting my newest one of the beer.
  var entries = document.getElementById("npa-entries");
  entries = entries ? JSON.parse(entries.textContent) : {};
  var rating = null;

  function fillRating(dialog, id) {
    var entry = entries[id];
    rating = entry;
    dialog.querySelector("[data-beer-name]").textContent = entry.name;
    dialog.querySelector("[data-beer-brewery]").textContent = entry.brewery;
    var form = dialog.querySelector("form");
    form.reset();
    form.querySelectorAll("input[name=rating]").forEach(function (r) { r.checked = Number(r.value) === entry.rating; });
    form.querySelectorAll("input[name=tags]").forEach(function (c) { c.checked = entry.tags.indexOf(c.value) >= 0; });
    form.elements.note.value = entry.note;
    form.querySelectorAll("input[name=visibility]").forEach(function (r) { r.checked = r.value === entry.visibility; });
    var pub = entry.base && entry.base.pub_name;
    var where = dialog.querySelector("[data-beer-pub]");
    where.hidden = !pub;
    if (pub) where.querySelector("span").textContent = pub;
    updateRating(form);
  }

  function updateRating(form) {
    var checked = form.querySelector("input[name=rating]:checked");
    form.querySelector("[data-verdict]").textContent = checked ? text.verdicts[Number(checked.value)] : "";
    form.querySelector("button[type=submit]").disabled = !checked;
    var tags = form.querySelectorAll("input[name=tags]:checked").length;
    form.querySelectorAll("input[name=tags]").forEach(function (c) { c.disabled = !c.checked && tags >= 3; });
  }

  var rateForm = document.querySelector("#npa-rate form");
  if (rateForm) {
    rateForm.addEventListener("change", function () { updateRating(rateForm); });
    rateForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      var dialog = rateForm.closest("dialog");
      var stars = Number(rateForm.querySelector("input[name=rating]:checked").value);
      var tags = Array.prototype.map.call(rateForm.querySelectorAll("input[name=tags]:checked"), function (c) { return c.value; });
      var visibility = rateForm.querySelector("input[name=visibility]:checked").value;
      var note = rateForm.elements.note.value.trim();
      var payload = rating.base
        ? Object.assign({}, rating.base, { rating: stars, tags: tags, note: note, visibility: visibility })
        : {
            client_id: uuid(), beer_name: rating.name, brewery_name: rating.brewery, beer_style: "", abv: null,
            quantity: 1, price_czk: null, rating: stars, tags: tags, note: note, pub_cache_key: "", pub_name: "",
            pub_city: "", visit_client_id: null, visibility: visibility, checked_in_at: new Date().toISOString(), ended_at: null,
          };
      busy(rateForm, true);
      var result = await send("/v1/beer-checkins", { method: "POST", body: payload, ugc: visibility !== "private" });
      busy(rateForm, false);
      if (!result.ok) return showError(dialog, message(result));
      window.location.reload();
    });
  }

  // Vyvěsit noc: the app's POST /v1/nights for one night; the server keeps one post per drinking day.
  var publish = document.querySelector("#npa-publish form");
  if (publish) {
    var publishDialog = publish.closest("dialog");
    var publishSubmit = publish.querySelector("[data-submit]");
    var nicknameLink = publish.querySelector("[data-nickname-link]");
    var chosenVisibility = function () { return publish.querySelector("input[name=visibility]:checked").value; };
    publish.addEventListener("change", function () {
      publishSubmit.textContent = chosenVisibility() === "public" ? publish.dataset.labelPublic : publish.dataset.labelFriends;
      showError(publishDialog, "");
      if (nicknameLink) nicknameLink.hidden = true;
    });
    publish.addEventListener("submit", async function (e) {
      e.preventDefault();
      var visibility = chosenVisibility();
      // Like the app: a public night needs a nickname, the world sees nobody without one.
      if (visibility === "public" && !("nickname" in publish.dataset)) {
        showError(publishDialog, text.needNickname);
        if (nicknameLink) nicknameLink.hidden = false;
        return;
      }
      var body = Object.assign(JSON.parse(publish.dataset.night), { visibility: visibility, updated_at: new Date().toISOString() });
      busy(publish, true);
      var result = await send("/v1/nights", { method: "POST", body: body, ugc: true });
      busy(publish, false);
      if (!result.ok) return showError(publishDialog, message(result));
      var after = new URL(window.location.href);
      after.searchParams.delete("vyvesit");
      after.hash = "";
      if (after.href === window.location.href) window.location.reload();
      else window.location.replace(after.href);
    });
  }
  // ?vyvesit=parta|svet opens the dialog, as the app's Dopsat opens its Vyvěsit sheet.
  var asked = new URLSearchParams(window.location.search).get("vyvesit");
  var askedDialog = document.getElementById("npa-publish");
  if (asked && askedDialog) {
    var preset = publish && publish.querySelector('input[name=visibility][value="' + (asked === "svet" ? "public" : "friends") + '"]');
    if (preset) { preset.checked = true; publish.dispatchEvent(new Event("change")); }
    askedDialog.showModal();
  }

  // Avatar: the same multipart upload as the app; the server re-encodes it.
  var avatar = document.getElementById("npa-avatar-file");
  if (avatar) {
    avatar.addEventListener("change", async function () {
      if (!avatar.files.length) return;
      var form = new FormData();
      form.append("avatar", avatar.files[0]);
      var scope = avatar.closest("[data-scope]");
      showError(scope, "");
      var result = await send("/v1/account/me/avatar", { method: "PUT", form: form, ugc: true });
      if (!result.ok) return showError(scope, message(result));
      window.location.reload();
    });
  }

  // Deleting the account: the app's DELETE with a one-off operation id, then the web is signed out.
  var del = document.getElementById("npa-delete-confirm");
  if (del) {
    del.addEventListener("click", async function () {
      var dialog = del.closest("dialog");
      busy(dialog, true);
      var result = await call("/v1/account/me", { method: "DELETE", headers: { "X-Account-Deletion-Operation-Id": uuid() } });
      busy(dialog, false);
      if (!result.ok) return showError(dialog, message(result));
      window.location.replace(del.dataset.done);
    });
  }

  // Adding a pub: look the address up first, show what was found, save only after a yes.
  var addPub = document.getElementById("npa-add-pub");
  if (addPub) {
    var found = null;
    var clientId = uuid();
    var step = addPub.querySelector("[data-found]");
    addPub.addEventListener("input", function () { found = null; step.hidden = true; addPub.querySelector("[data-save]").hidden = true; addPub.querySelector("[data-lookup]").hidden = false; });
    addPub.addEventListener("submit", async function (e) {
      e.preventDefault();
      var f = addPub.elements;
      var name = f.name.value.trim(), city = f.city.value.trim(), address = f.address.value.trim();
      if (!name || !city || !address) return showError(addPub, text.fillAll);
      busy(addPub, true);
      showError(addPub, "");
      if (!found) {
        var query = address + ", " + city;
        var looked = query.length <= 150
          ? await call("/v1/pubs/geocode", { method: "POST", body: { query: query, address_lookup: true } })
          : { ok: false, status: 400, data: null };
        busy(addPub, false);
        if (!looked.ok) return showError(addPub, looked.status === 0 ? text.offline : looked.status === 429 ? text.tooMany : text.lookupDown);
        found = pickAddress(looked.data && looked.data.items);
        if (!found) return showError(addPub, text.notFound);
        step.querySelector("span").textContent = found.address + ", " + found.city;
        step.hidden = false;
        addPub.querySelector("[data-lookup]").hidden = true;
        addPub.querySelector("[data-save]").hidden = false;
        return;
      }
      var result = await send("/v1/pubs", {
        method: "POST", ugc: true,
        body: { client_id: clientId, name: name.slice(0, 200), lat: found.lat, lng: found.lng, city: found.city, address: found.address },
      });
      busy(addPub, false);
      if (!result.ok) return showError(addPub, result.data && result.data.code === "location_not_found" ? text.notFound : message(result));
      var key = result.data && result.data.cache_key;
      window.location.assign(addPub.dataset.done + (key ? "?hospoda=" + encodeURIComponent(key) : ""));
    });
  }

  // Same rule as lookupAddedPubLocation in the app: only a precise street address confirms a pub.
  function pickAddress(items) {
    if (!Array.isArray(items)) return null;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || item.type !== "regional.address" || item.precise !== true || !item.position) continue;
      var lat = item.position.lat, lng = item.position.lon;
      if (typeof lat !== "number" || typeof lng !== "number" || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      var parts = Array.isArray(item.regionalStructure) ? item.regionalStructure : [];
      var street = parts.find(function (p) { return p && p.type === "regional.street"; });
      var town = parts.find(function (p) { return p && p.type === "regional.municipality"; });
      if (!street || !town || !String(street.name || "").trim() || !String(town.name || "").trim()) continue;
      return { lat: lat, lng: lng, address: street.name.trim(), city: town.name.trim() };
    }
    return null;
  }
})();
