// 共通: セッション認証(署名付きCookie)と Upstash Redis(REST)
const crypto = require("crypto");

function secret() {
  return process.env.SESSION_SECRET || "s:" + (process.env.APP_PASSWORD || "");
}
function sign(v) {
  return crypto.createHmac("sha256", secret()).update(String(v)).digest("hex");
}
// トークン: exp.role.name(base64url).署名   (旧形式 exp.署名 は管理者として扱う)
function makeToken(role, name) {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  role = role === "staff" ? "staff" : "admin";
  const nm = Buffer.from(String(name || ""), "utf8").toString("base64url");
  const p = exp + "." + role + "." + nm;
  return p + "." + sign(p);
}
// 戻り値: false または { role, name }
function authed(req) {
  if (!process.env.APP_PASSWORD) return false;
  const c = (req.headers.cookie || "").split(/;\s*/).find((x) => x.startsWith("dsess="));
  if (!c) return false;
  const t = decodeURIComponent(c.slice(6));
  const parts = t.split(".");
  let payload, h, role = "admin", name = "";
  if (parts.length === 2) { payload = parts[0]; h = parts[1]; }
  else if (parts.length === 4) {
    payload = parts.slice(0, 3).join("."); h = parts[3];
    role = parts[1] === "staff" ? "staff" : "admin";
    try { name = Buffer.from(parts[2], "base64url").toString("utf8"); } catch (e) { return false; }
  } else return false;
  if (!(Number(parts[0]) > Date.now())) return false;
  const a = Buffer.from(h), b = Buffer.from(sign(payload));
  if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) return false;
  return { role, name };
}
// 担当ごとのパスワード(scrypt)
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString("hex") };
}
function checkPw(pw, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const a = Buffer.from(crypto.scryptSync(String(pw), rec.salt, 32).toString("hex")), b = Buffer.from(rec.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function setCookie(res, token, maxAge) {
  res.setHeader("Set-Cookie", "dsess=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=" + maxAge);
}
function origin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return proto + "://" + (req.headers["x-forwarded-host"] || req.headers.host);
}

// ---- Redis ----
const MOCK = globalThis.__REDIS_MOCK__; // テスト用(本番では未設定)
function creds() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}
async function pipeline(cmds) {
  if (MOCK) return MOCK(cmds);
  const { url, token } = creds();
  if (!url || !token) throw Object.assign(new Error("データベースが設定されていません(Upstash Redis)"), { code: "no_db" });
  const r = await fetch(url.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(cmds),
  });
  const j = await r.json();
  if (!r.ok || !Array.isArray(j)) throw new Error("Redis error " + r.status + " " + JSON.stringify(j).slice(0, 200));
  j.forEach((x) => { if (x && x.error) throw new Error(x.error); });
  return j.map((x) => x.result);
}
async function redis(cmd) { return (await pipeline([cmd]))[0]; }

function body(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b || {};
}
module.exports = { hashPw, checkPw, authed, makeToken, setCookie, origin, pipeline, redis, body, sign };
