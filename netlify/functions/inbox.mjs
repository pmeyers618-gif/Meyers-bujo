import { getStore } from "@netlify/blobs";

// The "locker": a Netlify Function backed by Netlify Blobs.
//   GET  /api/inbox                        -> current inbox as an array of
//                                             {_merge,date,items} packets (app reads on open)
//   GET  /api/inbox?push=SECRET&text=...   -> add one item (Higgins uses this)
//   GET  /api/inbox?clear=SECRET           -> empty the inbox
//
// Each item is stored under its OWN blob key ("item:<id>") so concurrent or
// rapid writes never clobber one another (Netlify Blobs is eventually
// consistent, so a read-modify-write on a single key loses data). Reads list
// the keys and assemble the packets.

const SECRET = process.env.BUJO_PUSH_SECRET || "";
const STORE = "bujo-inbox";
const PREFIX = "item:";
const MAX_AGE_DAYS = 21;

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore(STORE);
  const push = url.searchParams.get("push");
  const clear = url.searchParams.get("clear");

  // ---- WRITE one item (own key => race-free) ----
  if (push !== null) {
    if (!SECRET || push !== SECRET) return json({ error: "unauthorized" }, 401);
    const text = (url.searchParams.get("text") || "").trim();
    if (!text) return json({ error: "missing text" }, 400);
    const id = url.searchParams.get("id") || (Date.now() + "-" + Math.round(Math.random() * 1e6));
    const item = {
      id,
      text,
      type: url.searchParams.get("type") || "task",
      star: url.searchParams.get("star") === "1",
      date: url.searchParams.get("date") || todayK(),
    };
    const time = url.searchParams.get("time");
    if (time && /^\d{1,2}:\d{2}$/.test(time)) {
      item.time = time;
      const dur = parseInt(url.searchParams.get("dur") || "", 10);
      if (!isNaN(dur)) item.dur = dur;
    }
    await store.setJSON(PREFIX + id, item);
    return json({ ok: true, added: id });
  }

  // ---- CLEAR ----
  if (clear !== null) {
    if (!SECRET || clear !== SECRET) return json({ error: "unauthorized" }, 401);
    const { blobs } = await store.list({ prefix: PREFIX });
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return json({ ok: true, cleared: blobs.length });
  }

  // ---- READ: gather all items, prune, group by date ----
  const { blobs } = await store.list({ prefix: PREFIX });
  const items = [];
  await Promise.all(
    blobs.map(async (b) => {
      const it = await store.get(b.key, { type: "json" });
      if (it) items.push(it);
    })
  );
  const cutoff = Date.now() - 86400000 * MAX_AGE_DAYS;
  const fresh = items.filter((it) => {
    const t = Date.parse((it.date || "") + "T00:00:00Z");
    return isNaN(t) || t >= cutoff;
  });
  const byDate = {};
  for (const it of fresh) (byDate[it.date] = byDate[it.date] || []).push(it);
  const packets = Object.keys(byDate)
    .sort()
    .map((d) => ({ _merge: true, date: d, items: byDate[d] }));
  return json(packets);
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
function todayK() {
  return new Date().toISOString().slice(0, 10);
}

export const config = { path: "/api/inbox" };
