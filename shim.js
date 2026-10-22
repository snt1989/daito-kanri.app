/* Claude アーティファクト実行環境(window.claude)の代わりに、Vercel の /api を使う互換層。
   アーティファクトの中で動いているとき(window.claude が既にある)は何もしない。 */
(function () {
  if (window.claude || location.protocol === "file:") return;
  var COLS = ["jobs", "emerg", "maint", "mdef", "water", "settings", "wform", "ac"];

  function post(path, data, signal) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(data || {}), signal: signal });
  }
  function rej(code, message, extra) { return Object.assign({ code: code, message: message || code }, extra || {}); }
  async function call(path, data, signal) {
    var r;
    try { r = await post(path, data, signal); }
    catch (e) { throw (e && e.name === "AbortError") ? rej("cancelled") : rej("server_unavailable", "通信に失敗しました", { retryable: true }); }
    var j = null; try { j = await r.json(); } catch (e) {}
    if (j && j.error) throw rej(j.error.code || "upstream_error", j.error.message, { connectUrl: j.error.connectUrl });
    if (!r.ok) throw rej(r.status === 401 ? "not_granted" : "upstream_error", "エラー(" + r.status + ")");
    return j;
  }

  /* ---- ログイン ---- */
  var authP = null;
  var dsAuth = window.dsAuth = { me: null, call: function (data) { return post("/api/auth", data).then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }); }); },
    logout: function () { return post("/api/auth", { op: "logout" }).then(function () { location.reload(); }); } };
  // 汎用API呼び出し(エラー時も { ok:false, error, status } を返す)
  window.dsApi = function (path, data) {
    return post(path, data).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j = j || {}; j.status = r.status; if (!r.ok && !j.error) j.error = "エラー(" + r.status + ")"; if (j.error && typeof j.error === "object") j.error = j.error.message || j.error.code; return j; }); });
  };
  function b64Of(blob) { return new Promise(function (res, rej2) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(",")[1] || ""); }; fr.onerror = function () { rej2(new Error("read")); }; fr.readAsDataURL(blob); }); }
  window.dsFiles = {
    put: async function (id, blob, meta) { return window.dsApi("/api/files", { op: "put", id: id, b64: await b64Of(blob), meta: meta }); },
    list: function () { return window.dsApi("/api/files", { op: "list" }); },
    exists: function (ids) { return window.dsApi("/api/files", { op: "exists", ids: ids }); },
    del: function (id) { return window.dsApi("/api/files", { op: "del", id: id }); },
    blob: async function (id) {
      var j = await window.dsApi("/api/files", { op: "get", id: id });
      if (!j.ok) return j;
      var bin = atob(j.b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return { ok: true, meta: j.meta, blob: new Blob([u], { type: (j.meta && j.meta.mime) || "application/octet-stream" }) };
    },
    open: async function (id) {
      var j = await window.dsApi("/api/files", { op: "get", id: id });
      if (!j.ok) return j;
      var bin = atob(j.b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      var blob = new Blob([u], { type: (j.meta && j.meta.mime) || "application/octet-stream" }), url = URL.createObjectURL(blob);
      var w = window.open(url, "_blank"); if (!w) { var a = document.createElement("a"); a.href = url; a.download = (j.meta && j.meta.name) || "file"; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return j;
    },
  };
  function setMe(j) { dsAuth.me = { role: j.role === "staff" ? "staff" : "admin", name: j.name || "" }; }
  function ensureAuth() {
    if (authP) return authP;
    authP = (async function () {
      try {
        var r = await post("/api/auth", { op: "check" });
        if (!r.ok) return false;
        var j = await r.json();
        if (j.ok) { setMe(j); return true; }
        if (j.nopw) { banner("サーバーに APP_PASSWORD が設定されていません。Vercel の環境変数を確認してください。"); return false; }
        return await loginUi();
      } catch (e) { return false; }
    })();
    return authP;
  }
  function banner(t) {
    var d = document.createElement("div");
    d.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99999;background:#a33;color:#fff;padding:10px 16px;font:14px sans-serif";
    d.textContent = t; document.body.appendChild(d);
  }
  function loginUi() {
    return new Promise(function (resolve) {
      var w = document.createElement("div");
      w.style.cssText = "position:fixed;inset:0;z-index:99998;background:#14201b;display:flex;align-items:center;justify-content:center;font-family:'Noto Sans JP',sans-serif";
      w.innerHTML = '<form style="background:#fff;border-radius:12px;padding:28px 26px;width:min(340px,92vw);box-shadow:0 8px 30px #0006">' +
        '<div style="font-weight:700;font-size:18px;color:#1b6847;margin-bottom:4px">大東受注ナビ</div>' +
        '<div style="font-size:13px;color:#62736b;margin-bottom:14px">担当名とパスワードを入力してください<br>(管理者は担当名を空欄のまま)</div>' +
        '<input class="nm" type="text" placeholder="担当名(管理者は空欄)" autocomplete="username" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #c9d3ce;border-radius:8px;font-size:16px;margin-bottom:8px">' +
        '<input class="pw" type="password" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:10px;border:1px solid #c9d3ce;border-radius:8px;font-size:16px" autofocus>' +
        '<div class="e" style="color:#b33;font-size:13px;min-height:18px;margin:6px 0"></div>' +
        '<button style="width:100%;padding:10px;border:0;border-radius:8px;background:#1b6847;color:#fff;font-size:15px;cursor:pointer">ログイン</button></form>';
      document.body.appendChild(w);
      var f = w.querySelector("form"), inp = w.querySelector(".pw"), nmI = w.querySelector(".nm"), er = w.querySelector(".e");
      try { nmI.value = localStorage.getItem("dsLoginName") || ""; } catch (e) {}
      setTimeout(function () { (nmI.value ? inp : nmI).focus(); }, 50);
      f.onsubmit = async function (ev) {
        ev.preventDefault(); er.textContent = "";
        try {
          var r = await post("/api/auth", { op: "login", name: nmI.value, password: inp.value });
          if (r.ok) { var jj = await r.json(); setMe(jj); try { localStorage.setItem("dsLoginName", nmI.value.trim()); } catch (e) {} w.remove(); resolve(true); } else { er.textContent = "担当名またはパスワードが違います"; inp.select(); }
        } catch (e) { er.textContent = "通信に失敗しました"; }
      };
    });
  }

  /* ---- db(共有データ。20秒ごとに更新を確認) ---- */
  var cache = {}, ver = {}, subs = [], pending = 0, polling = false;
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  function snapOf(sub) {
    var m = cache[sub.col] || {};
    if (sub.id) { var has = Object.prototype.hasOwnProperty.call(m, sub.id); return { exists: has, id: sub.id, data: function () { return has ? clone(m[sub.id]) : undefined; } }; }
    return { docs: Object.keys(m).map(function (id) { return { id: id, data: function () { return clone(m[id]); } }; }) };
  }
  function notify(col) {
    subs.forEach(function (s) { if (s.col === col && s.ready) { try { s.cb(snapOf(s)); } catch (e) {} } });
  }
  async function loadCol(col) {
    var j = await call("/api/db", { op: "list", col: col });
    var m = {}; j.docs.forEach(function (d) { m[d.id] = d.data; });
    cache[col] = m; ver[col] = j.ver;
  }
  function addSub(col, id, cb, err) {
    var s = { col: col, id: id, cb: cb, ready: false };
    subs.push(s);
    (async function () {
      try { if (!cache[col]) await loadCol(col); s.ready = true; cb(snapOf(s)); startPoll(); }
      catch (e) { if (err) err(e); }
    })();
    return function () { subs = subs.filter(function (x) { return x !== s; }); };
  }
  function startPoll() {
    if (polling) return; polling = true;
    setInterval(async function () {
      if (document.hidden || pending > 0) return;
      try {
        var j = await call("/api/db", { op: "ver" });
        for (var i = 0; i < COLS.length; i++) {
          var c = COLS[i];
          if (cache[c] && j.ver[c] !== ver[c] && pending === 0) { await loadCol(c); notify(c); }
        }
      } catch (e) {}
    }, 20000);
  }
  function docRef(path) {
    var p = path.split("/"), col = p[0], id = p[1];
    return {
      onSnapshot: function (cb, err) { return addSub(col, id, cb, err); },
      set: async function (data) {
        var d = clone(data); pending++;
        try {
          if (!cache[col]) cache[col] = {};
          cache[col][id] = d; notify(col);
          var j = await call("/api/db", { op: "set", path: path, data: d }); ver[col] = j.ver;
        } finally { pending--; }
      },
      delete: async function () {
        pending++;
        try {
          if (cache[col]) delete cache[col][id]; notify(col);
          var j = await call("/api/db", { op: "del", path: path }); ver[col] = j.ver;
        } finally { pending--; }
      },
    };
  }
  var dbNs = {
    collection: function (col) { return { onSnapshot: function (cb, err) { return addSub(col, null, cb, err); } }; },
    doc: docRef,
  };

  /* ---- sample(書類読み取り) ---- */
  function blobB64(b) {
    return new Promise(function (res, rej2) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(",")[1] || ""); };
      fr.onerror = function () { rej2(rej("bad_request", "画像を読み込めません")); };
      fr.readAsDataURL(b);
    });
  }
  async function sampleText(prompt, opts) {
    opts = opts || {};
    var imgs = [];
    for (var i = 0; i < (opts.images || []).length; i++) imgs.push(await blobB64(opts.images[i]));
    var j = await call("/api/ai", { prompt: String(prompt), images: imgs, tier: opts.modelTier || "default" }, opts.signal);
    return { text: j.text || "", truncated: !!j.truncated };
  }
  function pickJson(t) {
    t = String(t || "").replace(/```(?:json)?/gi, "");
    var a = t.search(/[\[{]/); if (a < 0) throw rej("bad_answer", "JSONを読み取れません");
    var open = t[a], close = open === "{" ? "}" : "]", z = t.lastIndexOf(close);
    if (z < a) throw rej("bad_answer", "JSONを読み取れません");
    try { return JSON.parse(t.slice(a, z + 1)); } catch (e) { throw rej("bad_answer", "JSONを読み取れません"); }
  }
  var sample = Object.assign(function (input, opts) { return sampleText(typeof input === "string" ? input : JSON.stringify(input), opts); }, {
    limits: async function () { return { images: true }; },
    json: async function (prompt, opts) { var r = await sampleText(prompt, opts); return pickJson(r.text); },
  });

  /* ---- downloads ---- */
  var downloads = {
    save: function (o) {
      return new Promise(function (resolve) {
        var blob = o.data instanceof Blob ? o.data : new Blob([o.data]), a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = o.filename || "download"; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); resolve({}); }, 500);
      });
    },
  };

  /* ---- mcp(Gmail のみ) ---- */
  var mcp = {
    callTool: async function (server, tool, input, opts) {
      if (server !== "Gmail") throw rej("not_in_manifest", "未対応のサーバーです");
      input = input || {};
      var sig = opts && opts.signal, j;
      if (tool === "search_threads") j = await call("/api/google", { op: "search", query: input.query, pageSize: input.pageSize }, sig);
      else if (tool === "get_message") j = await call("/api/google", { op: "message", messageId: input.messageId }, sig);
      else throw rej("not_in_manifest", "未対応のツールです");
      return { content: [], payload: j };
    },
  };

  window.claude = {
    use: async function (name) {
      if (["db", "sample", "downloads", "mcp"].indexOf(name) < 0) return null;
      if (name === "downloads") return downloads;
      if (!(await ensureAuth())) return null;
      return name === "db" ? dbNs : name === "sample" ? sample : mcp;
    },
  };
})();
