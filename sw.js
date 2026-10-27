// 最小のサービスワーカー: スマホ通知(プッシュ)の受信と、ホーム画面アイコンの件数バッジ
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
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
