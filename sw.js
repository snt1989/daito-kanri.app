// 最小のサービスワーカー: スマホ通知(プッシュ)の受信と、ホーム画面アイコンの件数バッジ
var CACHE = "daito-shell-v1";
var SHELL = ["/", "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).catch(function () {}).then(function () { return self.skipWaiting(); })); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE && k !== "daito-badge"; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
// 画面はネットワーク優先(更新をすぐ反映)。通信できないときだけ保存しておいた画面を使う。/api/ は対象外
self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.indexOf("/api/") === 0) return;
  e.respondWith(fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
    return res;
  }).catch(function () { return caches.match(req).then(function (m) { return m || caches.match("/"); }); }));
});
function badgeGet() { return caches.open("daito-badge").then(function (c) { return c.match("badge"); }).then(function (r) { return r ? r.text() : "0"; }).then(function (t) { return Number(t) || 0; }).catch(function () { return 0; }); }
function badgeSet(n) { return caches.open("daito-badge").then(function (c) { return c.put("badge", new Response(String(n))); }).catch(function () {}); }
function badgeShow(n) { try { if (self.navigator && self.navigator.setAppBadge) return n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge(); } catch (_) {} return Promise.resolve(); }
self.addEventListener("message", function (e) { if (e.data && e.data.type === "badge-sync") e.waitUntil(badgeSet(Number(e.data.n) || 0)); });
self.addEventListener("push", function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(badgeGet().then(function (n) { n += 1; return badgeSet(n).then(function () { return badgeShow(n); }); }).catch(function () {}).then(function () {
    return self.registration.showNotification(d.title || "大東受注ナビ", { body: d.body || "", tag: d.tag || "daito", renotify: true });
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if ("focus" in cs[i]) return cs[i].focus(); }
    return self.clients.openWindow("/");
  }));
});
