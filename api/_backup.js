// バックアップ: 全コレクションを JSON にして Redis に世代保存(直近 KEEP 世代)
const { pipeline, redis } = require("./_lib");
const COLS = ["jobs", "emerg", "maint", "mdef", "water", "settings", "wform"];
const KEEP = 14, CHUNK = 400000;
const META = "daito:bkmeta", LAST = "daito:bklast";
const ck = (id, n) => "daito:bk:" + id + ":" + n;

async function snapshot(by) {
  const r = await pipeline(COLS.map((c) => ["HGETALL", "daito:" + c]));
  const data = {}, counts = {};
  COLS.forEach((c, i) => {
    const flat = r[i] || [], arr = [];
    for (let k = 0; k + 1 < flat.length; k += 2) arr.push({ id: flat[k], data: flat[k + 1] });
    data[c] = arr; counts[c] = arr.length;
  });
  const json = JSON.stringify(data), n = Math.max(1, Math.ceil(json.length / CHUNK));
  const id = String(Date.now());
  for (let i = 0; i < n; i++) await pipeline([["SET", ck(id, i), json.slice(i * CHUNK, (i + 1) * CHUNK)]]);
  const meta = { id, at: new Date().toISOString(), size: json.length, chunks: n, counts, by: by || "手動" };
  await pipeline([["HSET", META, id, JSON.stringify(meta)], ["SET", LAST, id]]);
  await prune();
  return meta;
}
async function list() {
  const flat = (await redis(["HGETALL", META])) || [], out = [];
  for (let i = 0; i + 1 < flat.length; i += 2) { try { out.push(JSON.parse(flat[i + 1])); } catch (e) {} }
  return out.sort((a, b) => String(b.id).localeCompare(String(a.id)));
}
async function removeOne(m) {
  const cmds = [["HDEL", META, m.id]];
  for (let i = 0; i < m.chunks; i++) cmds.push(["DEL", ck(m.id, i)]);
  await pipeline(cmds);
}
async function prune() {
  const L = await list();
  for (const m of L.slice(KEEP)) await removeOne(m);
}
async function load(id) {
  const raw = await redis(["HGET", META, String(id)]);
  if (!raw) return null;
  const m = JSON.parse(raw);
  let json = "";
  for (let i = 0; i < m.chunks; i++) json += (await redis(["GET", ck(m.id, i)])) || "";
  return { meta: m, data: JSON.parse(json) };
}
async function restore(id) {
  const s = await load(id);
  if (!s) throw new Error("バックアップが見つかりません");
  await snapshot("復元前の自動保存");
  for (const c of COLS) {
    if (!(c in s.data)) continue;
    const items = s.data[c] || [];
    await pipeline([["DEL", "daito:" + c]]);
    for (let i = 0; i < items.length; i += 100) {
      const cmds = items.slice(i, i + 100).map((x) => ["HSET", "daito:" + c, String(x.id), typeof x.data === "string" ? x.data : JSON.stringify(x.data)]);
      if (cmds.length) await pipeline(cmds);
    }
    await pipeline([["INCR", "daito:ver:" + c]]);
  }
  return s.meta;
}
// 1日1回、データ更新のついでに自動バックアップ
async function maybeDaily() {
  try {
    const last = Number(await redis(["GET", LAST]) || 0);
    if (Date.now() - last > 22 * 3600 * 1000) await snapshot("自動");
  } catch (e) {}
}
module.exports = { snapshot, list, load, restore, removeOne, maybeDaily, COLS };
