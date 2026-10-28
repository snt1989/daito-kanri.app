// データ保存: コレクションごとに Redis の Hash(daito:<col>)。更新のたびに版番号(daito:ver:<col>)を増やす
const { authed, pipeline, body } = require("./_lib");
const { maybeDaily } = require("./_backup");
const { notify } = require("./push");
const COLS = ["jobs", "emerg", "maint", "mdef", "water", "settings", "wform", "ac", "photo", "budget"];
const key = (c) => "daito:" + c;
const vkey = (c) => "daito:ver:" + c;

function split(path) {
  const m = /^([a-z]+)\/([^/]{1,80})$/.exec(String(path || ""));
  if (!m || COLS.indexOf(m[1]) < 0) return null;
  return { col: m[1], id: m[2] };
}


const JOB_ST = ["指示書受領", "注文書受領", "請書提出済", "施工予定", "完了報告済", "請求済", "入金済"];
const EM_ST = ["受付", "出動中", "対応完了", "報告済", "請求済", "入金済"];
// 新規登録・進捗の変更を、管理者と担当者にスマホ通知する(サンプル・金額の更新は対象外)
async function pushEvents(col, o, n, actor) {
  if (!n || n.sample) return;
  const nm = [n.site, n.room].filter(Boolean).join(" ") || "(名称なし)", st = col === "jobs" ? JOB_ST : EM_ST, who = actor && actor.name ? "(" + actor.name + ")" : "";
  if (!o) return void (await notify(col === "jobs" ? "job" : "emerg", nm, (col === "jobs" ? "新しい案件が登録されました" : "緊急出動が登録されました") + who, n.staff, actor));
  if (o.status !== n.status && typeof n.status === "number") await notify("status", nm, (col === "emerg" ? "緊急出動: " : "") + (st[o.status] || "") + " → " + (st[n.status] || "") + who, n.staff, actor);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!authed(req)) return res.status(401).json({ error: { code: "not_granted", message: "ログインが必要です" } });
  const b = body(req);
  try {
    if (b.op === "ver") {
      const r = await pipeline(COLS.map((c) => ["GET", vkey(c)]));
      const ver = {}; COLS.forEach((c, i) => (ver[c] = Number(r[i] || 0)));
      return res.json({ ver });
    }
    if (b.op === "list") {
      if (COLS.indexOf(b.col) < 0) return res.status(400).json({ error: { code: "bad_request" } });
      const r = await pipeline([["HGETALL", key(b.col)], ["GET", vkey(b.col)]]);
      const flat = r[0] || [], docs = [];
      for (let i = 0; i + 1 < flat.length; i += 2) { try { docs.push({ id: flat[i], data: JSON.parse(flat[i + 1]) }); } catch (e) {} }
      return res.json({ docs, ver: Number(r[1] || 0) });
    }
    if (b.op === "set" || b.op === "del") {
      const p = split(b.path);
      if (!p) return res.status(400).json({ error: { code: "bad_request" } });
      let before = null;
      if (b.op === "set" && (p.col === "jobs" || p.col === "emerg")) { try { const o = (await pipeline([["HGET", key(p.col), p.id]]))[0]; before = o ? JSON.parse(o) : null; } catch (e) {} }
      const cmds = b.op === "set"
        ? [["HSET", key(p.col), p.id, JSON.stringify(b.data == null ? {} : b.data)], ["INCR", vkey(p.col)]]
        : [["HDEL", key(p.col), p.id], ["INCR", vkey(p.col)]];
      const r = await pipeline(cmds);
      await maybeDaily();
      if (b.op === "set" && b.data && (p.col === "jobs" || p.col === "emerg")) { try { await pushEvents(p.col, before, b.data, authed(req)); } catch (e) {} }
      return res.json({ ok: true, ver: Number(r[1]) });
    }
    if (b.op === "import") {
      // { data: { jobs:[{id,data}], ..., settings:{...} } }  一括取込(既存IDは上書き)
      const d = b.data || {}; let n = 0;
      for (const c of COLS) {
        let items = d[c];
        if (c === "settings" && items && !Array.isArray(items)) items = [{ id: "main", data: items }];
        if (!Array.isArray(items) || !items.length) continue;
        for (let i = 0; i < items.length; i += 100) {
          const cmds = items.slice(i, i + 100).filter((x) => x && x.id).map((x) => ["HSET", key(c), String(x.id), JSON.stringify(x.data || {})]);
          if (cmds.length) { await pipeline(cmds); n += cmds.length; }
        }
        await pipeline([["INCR", vkey(c)]]);
      }
      return res.json({ ok: true, imported: n });
    }
    res.status(400).json({ error: { code: "bad_request" } });
  } catch (e) {
    res.status(500).json({ error: { code: e.code === "no_db" ? "capability_disabled" : "upstream_error", message: String(e.message || e).slice(0, 200) } });
  }
};
