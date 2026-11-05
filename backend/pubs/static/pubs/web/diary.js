// Deník on the web: log beers, fix and delete them through the app's own /v1/ endpoints.
// The server validates everything; this file only builds the same payloads the app sends.
(function () {
  "use strict";

  var MINUTE = 60000;
  var CUTOFF_HOUR = 4;

  function readJson(id) {
    var node = document.getElementById(id);
    return node ? JSON.parse(node.textContent) : null;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function plural(n, words) {
    return n + " " + (n === 1 ? words[0] : n >= 2 && n <= 4 ? words[1] : words[2]);
  }

  // A clock time on a drinking day: hours before 04:00 belong to the next calendar day, as in the app.
  function atOnDay(day, clock) {
    var d = day.split("-").map(Number);
    var t = /^(\d{1,2}):(\d{2})$/.exec(clock || "");
    if (!t) return null;
    var h = Number(t[1]);
    return new Date(d[0], d[1] - 1, d[2] + (h < CUTOFF_HOUR ? 1 : 0), h, Number(t[2]));
  }

  function failure(result, text) {
    if (result.status === 0) return text.offline;
    if (result.status === 401 || result.status === 403 || result.status === 409) return text.signed_out;
    return text.failed;
  }

  function setStatus(node, message) {
    node.textContent = message || "";
    node.hidden = !message;
  }

  // ---------------------------------------------------------------------------
  // Zapsat pivo / Dopsat večer
  // ---------------------------------------------------------------------------

  var form = document.querySelector("[data-log-form]");
  if (form) initLog(form, readJson("dy-log-data"));

  function initLog(form, data) {
    var text = data.text;
    var date = form.querySelector("#dy-date");
    var from = form.querySelector("#dy-from");
    var to = form.querySelector("#dy-to");
    var dateError = form.querySelector("[data-date-error]");
    var places = form.querySelector("[data-places]");
    var search = form.querySelector("#dy-search");
    var searchToggle = form.querySelector("[data-search-toggle]");
    var searchInput = form.querySelector("#dy-search-q");
    var results = form.querySelector("[data-results]");
    var list = form.querySelector("[data-beers]");
    var total = form.querySelector("[data-total]");
    var status = form.querySelector("[data-status]");
    var submit = form.querySelector("[data-submit]");
    var rowTemplate = document.getElementById("dy-beer-row");
    var pubs = {};
    data.pubs.forEach(function (pub) { pubs["pub:" + pub.key] = pub; });
    var pending = null;
    var busy = false;

    function chosenPlace() {
      var chip = places.querySelector('[aria-pressed="true"]');
      if (!chip) return null;
      var id = chip.getAttribute("data-place");
      return pubs[id] ? { kind: "pub", pub: pubs[id] } : { kind: "outside", context: id };
    }

    function pressPlace(chip) {
      places.querySelectorAll("[data-place]").forEach(function (c) { c.setAttribute("aria-pressed", c === chip ? "true" : "false"); });
    }

    places.addEventListener("click", function (event) {
      var chip = event.target.closest("[data-place]");
      if (chip) pressPlace(chip);
    });

    searchToggle.addEventListener("click", function () {
      var open = search.hidden;
      search.hidden = !open;
      searchToggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) searchInput.focus();
    });

    var searchTimer = null;
    var searchSeq = 0;
    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      var q = searchInput.value.trim();
      if (q.length < 2) { results.textContent = ""; return; }
      searchTimer = setTimeout(async function () {
        var seq = ++searchSeq;
        var res = await window.npApi("/v1/pubs/search?q=" + encodeURIComponent(q));
        if (seq !== searchSeq) return;
        results.textContent = "";
        var items = res.ok && res.data && res.data.items ? res.data.items.slice(0, 8) : [];
        if (!items.length) {
          var empty = document.createElement("p");
          empty.className = "np-small np-muted";
          empty.textContent = res.ok ? text.search_empty : failure(res, text);
          results.appendChild(empty);
          return;
        }
        items.forEach(function (item) {
          var button = document.createElement("button");
          button.type = "button";
          button.className = "dy-result";
          button.setAttribute("role", "listitem");
          var title = document.createElement("b");
          title.textContent = item.name;
          var meta = document.createElement("span");
          meta.textContent = item.address || "";
          button.append(title, meta);
          button.addEventListener("click", function () { pickPub(item); });
          results.appendChild(button);
        });
      }, 250);
    });

    function pickPub(item) {
      var id = "pub:" + item.cache_key;
      pubs[id] = { key: item.cache_key, name: item.name, lat: item.lat, lng: item.lon, city: item.address || "", external_id: item.id };
      var chip = places.querySelector('[data-place="' + CSS.escape(id) + '"]');
      if (!chip) {
        chip = document.createElement("button");
        chip.type = "button";
        chip.className = "np-chip";
        chip.setAttribute("data-place", id);
        chip.textContent = item.name;
        places.insertBefore(chip, places.querySelector('[data-place="private"]'));
      }
      pressPlace(chip);
      search.hidden = true;
      searchToggle.setAttribute("aria-expanded", "false");
      searchInput.value = "";
      results.textContent = "";
    }

    function rows() {
      return Array.prototype.map.call(list.querySelectorAll("[data-beer]"), function (row) {
        var price = Number(row.querySelector("[data-price]").value);
        return {
          name: row.querySelector("[data-name]").value.trim(),
          n: Number(row.querySelector("[data-n]").value),
          price: price > 0 && price <= 1000 ? Math.round(price) : null,
        };
      });
    }

    function refreshTotal() {
      var count = 0;
      var spent = 0;
      rows().forEach(function (r) {
        if (!r.name) return;
        count += r.n;
        if (r.price) spent += r.price * r.n;
      });
      total.textContent = count ? plural(count, text.beers) + (spent ? " · " + spent + " " + text.currency : "") : "";
      submit.disabled = busy || count === 0;
    }

    function addRow(name, price) {
      var row = rowTemplate.content.firstElementChild.cloneNode(true);
      var input = row.querySelector("[data-name]");
      var id = "dy-beer-" + list.children.length;
      input.id = id;
      input.setAttribute("aria-controls", id + "-suggest");
      row.querySelector("[data-suggest]").id = id + "-suggest";
      row.querySelector("label").setAttribute("for", id);
      input.value = name || "";
      row.querySelector("[data-price]").value = price || "";
      list.appendChild(row);
      refreshTotal();
      return input;
    }

    list.addEventListener("click", function (event) {
      var step = event.target.closest("[data-step]");
      if (!step) return;
      var row = step.closest("[data-beer]");
      var output = row.querySelector("[data-n]");
      var n = Math.max(0, Number(output.value) + Number(step.getAttribute("data-step")));
      output.value = String(n);
      if (n === 0 && list.children.length > 1) row.remove();
      refreshTotal();
    });
    list.addEventListener("input", refreshTotal);

    var suggestTimer = null;
    var suggestSeq = 0;

    function closeSuggest(input) {
      clearTimeout(suggestTimer);
      suggestSeq++;
      var box = input.closest("[data-beer]").querySelector("[data-suggest]");
      box.hidden = true;
      box.textContent = "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }

    function showSuggest(input, suggestions) {
      var box = input.closest("[data-beer]").querySelector("[data-suggest]");
      var typed = input.value.trim().toLowerCase();
      var seen = {};
      box.textContent = "";
      suggestions.forEach(function (s) {
        var key = s.name.toLowerCase();
        if (seen[key] || key === typed) return;
        seen[key] = true;
        var option = document.createElement("div");
        option.className = "dy-suggest__item";
        option.id = box.id + "-" + box.children.length;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.textContent = s.name;
        box.appendChild(option);
      });
      box.hidden = !box.children.length;
      input.setAttribute("aria-expanded", box.hidden ? "false" : "true");
      input.removeAttribute("aria-activedescendant");
      // On a phone the list would otherwise open under the tab bar.
      if (!box.hidden) box.scrollIntoView({ block: "nearest" });
    }

    function pickSuggestion(input, option) {
      input.value = option.textContent;
      closeSuggest(input);
      refreshTotal();
    }

    list.addEventListener("input", function (event) {
      var input = event.target;
      if (!input.matches("[data-name]")) return;
      clearTimeout(suggestTimer);
      var q = input.value.trim();
      if (q.length < 2) { closeSuggest(input); return; }
      var seq = ++suggestSeq;
      suggestTimer = setTimeout(async function () {
        var res = await window.npApi("/v1/beer-brands/suggest?limit=6&q=" + encodeURIComponent(q));
        if (seq !== suggestSeq || document.activeElement !== input) return;
        showSuggest(input, res.ok && res.data ? res.data.suggestions : []);
      }, 220);
    });

    list.addEventListener("keydown", function (event) {
      var input = event.target;
      if (!input.matches("[data-name]")) return;
      var box = input.closest("[data-beer]").querySelector("[data-suggest]");
      if (box.hidden) {
        if (event.key === "Escape" || event.key === "Enter") closeSuggest(input);
        return;
      }
      var options = Array.prototype.slice.call(box.children);
      var active = box.querySelector('[aria-selected="true"]');
      var index = options.indexOf(active);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        index = event.key === "ArrowDown" ? (index + 1) % options.length : (index <= 0 ? options.length : index) - 1;
        options.forEach(function (o, i) { o.setAttribute("aria-selected", i === index ? "true" : "false"); });
        input.setAttribute("aria-activedescendant", options[index].id);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (active) pickSuggestion(input, active);
        else closeSuggest(input);
      } else if (event.key === "Escape") {
        closeSuggest(input);
      }
    });

    // mousedown keeps focus in the input, so blur only fires when the user leaves the field.
    list.addEventListener("mousedown", function (event) {
      if (event.target.closest("[data-suggest]")) event.preventDefault();
    });
    list.addEventListener("click", function (event) {
      var option = event.target.closest(".dy-suggest__item");
      if (option) pickSuggestion(option.closest("[data-beer]").querySelector("[data-name]"), option);
    });
    list.addEventListener("focusout", function (event) {
      if (event.target.matches("[data-name]")) closeSuggest(event.target);
    });

    form.querySelector("[data-add-beer]").addEventListener("click", function () { addRow("", "").focus(); });
    addRow(data.beer ? data.beer.name : "", data.beer ? data.beer.price : "");

    [date, from, to].forEach(function (input) { input.addEventListener("input", function () { setStatus(dateError, ""); }); });

    function plan() {
      var day = date.value;
      var now = Date.now() + MINUTE;
      var start = atOnDay(day, from.value);
      var end = to.value ? atOnDay(day, to.value) : null;
      if (!day || day > data.today || day < data.earliest || !start || start.getTime() > now || (to.value && (!end || end < start || end.getTime() > now))) {
        return null;
      }
      var beers = [];
      rows().forEach(function (r) {
        for (var k = 0; r.name && k < r.n; k++) beers.push(r);
      });
      // Same spacing as the app's Dopsat: across the given time, else half an hour apart.
      var span = end ? end - start : (beers.length - 1) * 30 * MINUTE;
      var step = beers.length > 1 ? span / (beers.length - 1) : 0;
      return {
        day: day,
        place: chosenPlace(),
        beers: beers.map(function (r, i) {
          return { name: r.name, price: r.price, at: new Date(Math.min(start.getTime() + step * i, Date.now())).toISOString() };
        }),
      };
    }

    function drinkPayload(beer, place, clientId) {
      var body = { client_id: clientId, beer: { name: beer.name }, drank_at: beer.at };
      if (beer.price) body.beer.price_czk = beer.price;
      if (place.kind === "pub") {
        body.beer.volume_ml = 500;
        body.name = place.pub.name;
        body.lat = place.pub.lat;
        body.lng = place.pub.lng;
        if (place.pub.city) body.city = place.pub.city;
        if (place.pub.external_id) body.external_id = place.pub.external_id;
      } else {
        body.place_context = place.context;
      }
      return body;
    }

    // The evening at a pub is a visit, like the app's session: append to the visit of
    // the same pub and drinking day, or open one. A past night is closed at its last drink,
    // and so is a "Jen pro mě" one: an open visit would show the crew where I sit.
    function visitPayload(step) {
      var pub = step.place.pub;
      var times = step.beers.map(function (b) { return b.at; }).sort();
      var existing = data.visits.filter(function (v) { return v.key === pub.key && v.day === step.day; })[0];
      var started = existing && Date.parse(existing.started_at) < Date.parse(times[0]) ? existing.started_at : times[0];
      var last = times[times.length - 1];
      var ended = existing && existing.ended_at && Date.parse(existing.ended_at) > Date.parse(last) ? existing.ended_at : last;
      var body = {
        client_id: existing ? existing.client_id : step.visitId,
        name: pub.name,
        lat: pub.lat,
        lng: pub.lng,
        started_at: started,
        ended_at: ended,
        updated_at: new Date().toISOString(),
      };
      if (pub.city) body.city = pub.city;
      if (pub.external_id) body.external_id = pub.external_id;
      if (step.day !== data.today || step.onlyMe) body.closed_at = ended;
      return body;
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (busy) return;
      var next = plan();
      if (!next) { setStatus(dateError, text.date_error); return; }
      if (!next.beers.length || !next.place) return;
      // A retry of the same entry reuses its IDs, so the server answers "duplicate" instead of a second beer.
      var signature = JSON.stringify([next.day, next.place, from.value, to.value, rows()]);
      if (!pending || pending.signature !== signature) {
        pending = { signature: signature, ids: next.beers.map(uuid), visitId: uuid(), done: {} };
      }
      busy = true;
      submit.disabled = true;
      setStatus(status, "");
      for (var i = 0; i < next.beers.length; i++) {
        var id = pending.ids[i];
        if (pending.done[id]) continue;
        var res = await window.npApi("/v1/drinks", { method: "POST", body: drinkPayload(next.beers[i], next.place, id) });
        if (!res.ok) {
          busy = false;
          refreshTotal();
          setStatus(status, failure(res, text));
          return;
        }
        pending.done[id] = true;
      }
      var toParta = form.querySelector("input[name=scope]:checked").value === "parta";
      if (next.place.kind === "pub") {
        var visit = await window.npApi("/v1/pub-visits", { method: "POST", body: visitPayload({ day: next.day, place: next.place, beers: next.beers, visitId: pending.visitId, onlyMe: !toParta }) });
        if (!visit.ok) {
          busy = false;
          refreshTotal();
          setStatus(status, failure(visit, text));
          return;
        }
      }
      // "Parta" opens the night's Vyvěsit dialog, like the app's Dopsat opens its Vyvěsit sheet.
      window.location.assign(data.night_url.replace("0000-00-00", next.day) + (toParta ? "?vyvesit=parta" : ""));
    });
  }

  // ---------------------------------------------------------------------------
  // Detail večera: fix or delete one beer
  // ---------------------------------------------------------------------------

  var dialog = document.getElementById("dy-edit");
  if (dialog) initEdit(dialog, readJson("dy-night-data"));

  function initEdit(dialog, data) {
    var text = data.texts;
    var editForm = dialog.querySelector("[data-edit-form]");
    var nameInput = dialog.querySelector("#f-edit-name");
    var priceInput = dialog.querySelector("#f-edit-price");
    var error = dialog.querySelector("[data-edit-error]");
    var confirmBox = dialog.querySelector("[data-confirm]");
    var buttons = dialog.querySelectorAll("button");
    var current = null;

    function lock(on) { buttons.forEach(function (b) { b.disabled = on; }); }

    document.querySelector("[data-drinks]").addEventListener("click", function (event) {
      var button = event.target.closest("[data-edit]");
      if (!button) return;
      current = button.closest("[data-drink]");
      nameInput.value = current.getAttribute("data-name");
      priceInput.value = current.getAttribute("data-price");
      setStatus(error, "");
      confirmBox.hidden = true;
      lock(false);
      dialog.showModal();
      nameInput.focus();
    });

    dialog.querySelector("[data-close]").addEventListener("click", function () { dialog.close(); });

    editForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      var name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      var price = priceInput.value === "" ? null : Math.round(Number(priceInput.value));
      lock(true);
      var res = await window.npApi("/v1/drinks/" + current.getAttribute("data-drink"), { method: "PATCH", body: { beer_name: name, price_czk: price } });
      if (res.ok) { window.location.reload(); return; }
      lock(false);
      setStatus(error, res.status === 400 ? text.invalid : failure(res, text));
    });

    dialog.querySelector("[data-delete]").addEventListener("click", function () { confirmBox.hidden = false; });
    dialog.querySelector("[data-confirm-no]").addEventListener("click", function () { confirmBox.hidden = true; });
    dialog.querySelector("[data-confirm-yes]").addEventListener("click", async function () {
      lock(true);
      var id = current.getAttribute("data-drink");
      var res = await window.npApi("/v1/drinks/" + id, { method: "DELETE" });
      if (!res.ok) { lock(false); setStatus(error, failure(res, text)); return; }
      var visitResult = await syncVisitAfterDelete(id);
      if (visitResult && !visitResult.ok) { lock(false); setStatus(error, failure(visitResult, text)); return; }
      window.location.reload();
    });

    // Like the app's deleteSessionDrink: the pub's visit shrinks to the drinks left there,
    // or goes away with its last drink.
    async function syncVisitAfterDelete(id) {
      var gone = data.drinks.filter(function (x) { return x.id === id; })[0];
      if (!gone || gone.key.indexOf("ctx:") === 0) return null;
      var visit = data.visits.filter(function (v) { return v.key === gone.key; })[0];
      if (!visit) return null;
      var left = data.drinks.filter(function (x) { return x.key === gone.key && x.id !== id; }).map(function (x) { return x.at; });
      var now = new Date().toISOString();
      if (!left.length) {
        return window.npApi("/v1/pub-visits/" + visit.client_id, { method: "DELETE", body: { updated_at: now } });
      }
      var body = {
        client_id: visit.client_id,
        name: visit.name,
        lat: visit.lat,
        lng: visit.lng,
        started_at: left[0],
        ended_at: left[left.length - 1],
        updated_at: now,
      };
      if (visit.city) body.city = visit.city;
      if (visit.external_id) body.external_id = visit.external_id;
      if (visit.closed_at) body.closed_at = left[left.length - 1];
      return window.npApi("/v1/pub-visits", { method: "POST", body: body });
    }
  }
})();
