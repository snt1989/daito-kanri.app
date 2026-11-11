// Gmail 連携(読み取り＋eFaxへのFAX送信メール)。Googleアカウントで一度だけ許可し、更新トークンを Redis に保存する
const { authed, origin, redis, body, sign } = require("./_lib");
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
const RK = "daito:google:refresh";
let cached = { token: "", exp: 0 };

function redirectUri(req) { return process.env.GOOGLE_REDIRECT_URI || origin(req) + "/api/google?op=callback"; }
function fail(res, status, code, message, extra) {
  return res.status(status).json({ error: Object.assign({ code, message }, extra || {}) });
}
async function accessToken() {
  if (cached.token && cached.exp > Date.now() + 30000) return cached.token;
  const refresh = await redis(["GET", RK]);
  if (!refresh) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refresh, grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) { if (j.error === "invalid_grant") await redis(["DEL", RK]); return null; }
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3000) * 1000 };
  return cached.token;
}
async function gget(path, tok) {
  const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/" + path, { headers: { Authorization: "Bearer " + tok } });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error((j.error && j.error.message) || r.status), { status: r.status });
  return j;
}
function hdr(m, name) {
  const h = ((m.payload && m.payload.headers) || []).find((x) => x.name.toLowerCase() === name);
  return h ? h.value : "";
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const q = req.query || {};
  const op = q.op || body(req).op;
  if (!authed(req)) {
    if (op === "login" || op === "callback") { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(401).send("先にアプリでログインしてください。"); }
    return fail(res, 401, "not_granted", "ログインが必要です");
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    if (op === "login" || op === "callback") { res.setHeader("Content-Type", "text/html; charset=utf-8"); return res.status(503).send("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が設定されていません。"); }
    return fail(res, 503, "capability_disabled", "Gmail連携の設定(GOOGLE_CLIENT_ID/SECRET)がありません");
  }
  try {
    if (op === "login") {
      const state = Date.now() + "." + sign("g" + Date.now());
      const u = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: "code",
        scope: SCOPE, access_type: "offline", prompt: "consent", state,
      });
      res.statusCode = 302; res.setHeader("Location", u); return res.end();
    }
    if (op === "callback") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      const st = String(q.state || ""), i = st.indexOf(".");
      if (i < 0 || sign("g" + st.slice(0, i)) !== st.slice(i + 1) || Date.now() - Number(st.slice(0, i)) > 600000) return res.status(400).send("状態が無効です。もう一度お試しください。");
      if (!q.code) return res.status(400).send("許可されませんでした: " + String(q.error || ""));
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: String(q.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: "authorization_code" }),
      });
      const j = await r.json();
      if (!j.refresh_token) return res.status(400).send("更新トークンを取得できませんでした。Googleアカウントの「サードパーティのアクセス」から一度このアプリを削除して、もう一度接続してください。");
      await redis(["SET", RK, j.refresh_token]); cached = { token: "", exp: 0 };
      return res.status(200).send('<meta charset="utf-8"><body style="font-family:sans-serif;padding:2em">Gmailを接続しました。このタブを閉じて、アプリで「再読み込み」を押してください。</body>');
    }
    const tok = await accessToken();
    if (!tok) return fail(res, 200, "server_not_connected", "Gmailが未接続です", { connectUrl: "/api/google?op=login" });
    const b = body(req);
    if (op === "status") return res.json({ ok: true });
    if (op === "search") {
      const l = await gget("threads?" + new URLSearchParams({ q: String(b.query || ""), maxResults: String(Math.min(50, Number(b.pageSize) || 20)) }), tok);
      const ids = (l.threads || []).map((t) => t.id);
      const threads = await Promise.all(ids.map(async (id) => {
        const t = await gget("threads/" + id + "?format=metadata&metadataHeaders=Subject&metadataHeaders=From", tok);
        return { id, messages: (t.messages || []).map((m) => ({
          id: m.id, date: new Date(Number(m.internalDate)).toISOString(), subject: hdr(m, "subject"),
          sender: hdr(m, "from"), snippet: m.snippet, sizeEstimate: m.sizeEstimate, labelIds: m.labelIds,
        })) };
      }));
      return res.json({ threads });
    }
    if (op === "message") {
      if (!/^[A-Za-z0-9]+$/.test(String(b.messageId || ""))) return fail(res, 400, "bad_request", "messageId");
      const m = await gget("messages/" + b.messageId + "?format=raw", tok);
      return res.json({ id: m.id, raw: m.raw });
    }
    if (op === "send") {
      // eFaxの「メールでFAX送信」専用。宛先は 番号@efaxsend.com だけを許可する(ほかのメールは送れない)
      const to = (Array.isArray(b.to) ? b.to : [b.to]).map((x) => String(x || "").trim()).filter(Boolean);
      if (!to.length || to.length > 5 || !to.every((x) => /^81\d{9,10}@efaxsend\.com$/.test(x))) return fail(res, 400, "bad_request", "宛先はFAX番号(81から始まる)@efaxsend.com だけ指定できます");
      const att = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 5);
      const enc = (s) => "=?UTF-8?B?" + Buffer.from(String(s), "utf8").toString("base64") + "?=";
      const bd = "dk" + Date.now().toString(36);
      const from = String(b.from || "").trim();
      let mime = (/^[^@\s<>]+@[^@\s<>]+$/.test(from) ? "From: " + from + "\r\n" : "") + "To: " + to.join(", ") + "\r\nSubject: " + (b.subject ? enc(String(b.subject).slice(0, 200)) : "") + "\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"" + bd + "\"\r\n\r\n";
      mime += "--" + bd + "\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + Buffer.from(String(b.body || ""), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n") + "\r\n";
      for (const a of att) {
        const c = String(a.content || "").replace(/\s+/g, ""); if (!/^[A-Za-z0-9+/=]+$/.test(c)) return fail(res, 400, "bad_request", "添付の形式が正しくありません");
        const fn = String(a.filename || "fax.pdf").replace(/["\r\n]/g, "");
        mime += "--" + bd + "\r\nContent-Type: " + (String(a.mimeType || "application/pdf").replace(/[^\w\/.+-]/g, "")) + "; name=\"" + enc(fn) + "\"\r\nContent-Disposition: attachment; filename=\"" + enc(fn) + "\"\r\nContent-Transfer-Encoding: base64\r\n\r\n" + c.replace(/.{76}/g, "$&\r\n") + "\r\n";
      }
      mime += "--" + bd + "--";
      const raw = Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: "Bearer " + tok, "content-type": "application/json" }, body: JSON.stringify({ raw }) });
      const j = await r.json();
      if (!r.ok) {
        const insuff = r.status === 403 || /insufficient|scope/i.test(JSON.stringify(j.error || {}));
        return fail(res, 200, insuff ? "needs_reauth" : "upstream_error", insuff ? "FAX送信の許可がありません。Gmailを接続し直してください" : String((j.error && j.error.message) || r.status).slice(0, 200), insuff ? { connectUrl: "/api/google?op=login" } : {});
      }
      return res.json({ id: j.id, threadId: j.threadId, labelIds: j.labelIds });
    }
    fail(res, 400, "bad_request", "op");
  } catch (e) {
    fail(res, e.status === 401 || e.status === 403 ? 200 : 502, e.status === 401 || e.status === 403 ? "needs_reauth" : "upstream_error", String(e.message || e).slice(0, 200), e.status ? { connectUrl: "/api/google?op=login" } : {});
  }
};
