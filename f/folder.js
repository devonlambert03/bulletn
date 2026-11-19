// Shared folder viewer. The folder lives only in the URL fragment (after #),
// which browsers never send to the server. This script decodes it in the
// browser and renders it. It does not send, store or log the data.
(function () {
  "use strict";

  var MAX_PAYLOAD = 64 * 1024;   // encoded fragment, in characters
  var MAX_JSON = 1024 * 1024;    // decompressed bytes, guards against deflate bombs
  var MAX_NAME = 80;
  var MAX_ITEMS = 100;

  var PLATFORMS = [
    ["TikTok", ["tiktok.com"]],
    ["Instagram", ["instagram.com", "instagr.am"]],
    ["YouTube", ["youtube.com", "youtu.be"]],
    ["Facebook", ["facebook.com", "fb.com", "fb.watch"]],
    ["Pinterest", ["pinterest.com", "pin.it"]]
  ];

  function fail() { throw new Error("invalid"); }

  function base64UrlToBytes(s) {
    if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) fail();
    var b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function inflateRaw(bytes) {
    var reader = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    var chunks = [], total = 0;
    for (;;) {
      var r = await reader.read();
      if (r.done) break;
      total += r.value.length;
      if (total > MAX_JSON) { reader.cancel(); fail(); }
      chunks.push(r.value);
    }
    var out = new Uint8Array(total), pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  function charCount(s) {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      var n = 0;
      for (var _ of new Intl.Segmenter().segment(s)) n++;
      return n;
    }
    return Array.from(s).length;
  }

  function hostOf(url) { return url.hostname.replace(/^www\./, ""); }

  function platformOf(host) {
    for (var i = 0; i < PLATFORMS.length; i++) {
      var domains = PLATFORMS[i][1];
      for (var j = 0; j < domains.length; j++) {
        var d = domains[j];
        if (host === d || host.slice(-(d.length + 1)) === "." + d) return PLATFORMS[i][0];
      }
    }
    return host;
  }

  function cleanItem(raw) {
    if (!raw || typeof raw !== "object" || typeof raw.u !== "string") return null;
    var url;
    try { url = new URL(raw.u); } catch (e) { return null; }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    var host = hostOf(url);
    if (!host) return null;
    var title = typeof raw.t === "string" ? raw.t.trim() : "";
    return { title: title || host, host: host, platform: platformOf(host), url: url.href };
  }

  // Returns {name, items} or throws on any invalid input.
  async function decodeFolder(payload) {
    if (typeof payload !== "string" || !payload || payload.length > MAX_PAYLOAD) fail();
    var json = new TextDecoder("utf-8", { fatal: true }).decode(await inflateRaw(base64UrlToBytes(payload)));
    var data = JSON.parse(json);
    if (!data || typeof data !== "object" || Array.isArray(data)) fail();
    if (data.v !== 1) fail();
    if (typeof data.n !== "string" || !data.n.trim() || charCount(data.n) > MAX_NAME) fail();
    if (!Array.isArray(data.i) || data.i.length > MAX_ITEMS) fail();
    var items = [];
    data.i.forEach(function (raw) {
      var item = cleanItem(raw);
      if (item) items.push(item);
    });
    return { name: data.n.trim(), items: items };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { decodeFolder: decodeFolder, platformOf: platformOf };
    return;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  // If Bulletn is not installed (or is too old to know folder links), the
  // page is still visible after a moment, so send the person to the App Store.
  var APP_STORE_URL = "https://apps.apple.com/app/bulletn-saved-sorted/id6829573401";

  function openWithFallback(event) {
    event.preventDefault();
    var link = event.currentTarget.href;
    var left = false;
    function onHide() { if (document.hidden) left = true; }
    function onPageHide() { left = true; }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    window.location.href = link;
    setTimeout(function () {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      if (!left && !document.hidden) window.location.href = APP_STORE_URL;
    }, 1500);
  }

  function showError() {
    document.getElementById("folder").hidden = true;
    document.getElementById("folder-error").hidden = false;
  }

  function render(folder, payload) {
    document.getElementById("folder-name").textContent = folder.name;
    var n = folder.items.length;
    document.getElementById("folder-count").textContent = n + (n === 1 ? " save" : " saves");
    var openBtn = document.getElementById("open-in-app");
    openBtn.href = "bulletn://import#" + payload;
    openBtn.onclick = openWithFallback;

    var list = document.getElementById("folder-items");
    list.replaceChildren();
    folder.items.forEach(function (item) {
      var a = el("a", "card share-item");
      a.href = item.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.appendChild(el("span", "share-title", item.title));
      var meta = el("span", "share-meta");
      meta.appendChild(el("span", "share-platform", item.platform));
      if (item.platform !== item.host) meta.appendChild(el("span", "share-host", item.host));
      a.appendChild(meta);
      var li = el("li");
      li.appendChild(a);
      list.appendChild(li);
    });

    document.getElementById("folder-error").hidden = true;
    document.getElementById("folder").hidden = false;
  }

  function load() {
    var payload = location.hash.replace(/^#/, "");
    decodeFolder(payload).then(function (folder) {
      render(folder, payload);
    }, showError);
  }

  window.addEventListener("hashchange", load);
  load();
})();
