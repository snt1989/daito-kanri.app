// 共通: セッション認証(署名付きCookie)と Upstash Redis(REST)
const crypto = require("crypto");

function secret() {
  return process.env.SESSION_SECRET || "s:" + (process.env.APP_PASSWORD || "");
}
function sign(v) {
  return crypto.createHmac("sha256", secret()).update(String(v)).digest("hex");
}
function makeToken() {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  return exp + "." + sign(exp);
}
function authed(req) {
  if (!process.env.APP_PASSWORD) return false;
  const c = (req.headers.cookie || "").split(/;\s*/).find((x) => x.startsWith("dsess="));
  if (!c) return false;
  const t = decodeURIComponent(c.slice(6));
  const i = t.indexOf(".");
  if (i < 0) return false;
  const e = t.slice(0, i), h = t.slice(i + 1);
  if (!(Number(e) > Date.now())) return false;
  const a = Buffer.from(h), b = Buffer.from(sign(e));
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
module.exports = { authed, makeToken, setCookie, origin, pipeline, redis, body, sign };
