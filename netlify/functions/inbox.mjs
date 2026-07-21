import { getStore } from "@netlify/blobs";

// The "locker": a Netlify Function backed by Netlify Blobs.
//   GET  /api/inbox                         -> returns the current inbox as an
//                                              array of {_merge,date,items} packets
//   GET  /api/inbox?push=SECRET&text=...    -> appends one item (Higgins uses this)
//   GET  /api/inbox?clear=SECRET            -> empties the inbox
//
// Higgins writes with a plain GET (its only outbound channel is a URL fetch),
// so items ride in the query string to Paul's own endpoint. Low-sensitivity
// task text only. The push secret gates all writes.

const SECRET = process.env.BUJO_PUSH_SECRET || "";
const STORE = "bujo-inbox";
const KEY = "items";
const MAX_AGE_DAYS = 21;

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore(STORE);

  const push = url.searchParams.get("push");
  const clear = url.searchParams.get("clear");

  // ---- WRITE: append one item ----
  if (push !== null) {
    if (!SECRET || push !== SECRET) return json({ error: "unauthorized" }, 401);
    const text = (url.searchParams.get("text") || "").trim();
    if (!text) return json({ error: "missing text" }, 400);
    const item = {
      id: url.searchParams.get("id") || (Date.now() + "-" + Math.round(Math.random() * 1e6)),
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
    let items = (await store.get(KEY, { type: "json" })) || [];
    if (!items.some((x) => x.id === item.id)) items.push(item);
    items = prune(items);
    await store.setJSON(KEY, items);
    return json({ ok: true, added: item.id, count: items.length });
  }

  // ---- CLEAR ----
  if (clear !== null) {
    if (!SECRET || clear !== SECRET) return json({ error: "unauthorized" }, 401);
    await store.setJSON(KEY, []);
    return json({ ok: true, cleared: true });
  }

  // ---- READ: group items by date into packets the BuJo loader understands ----
  let items = (await store.get(KEY, { type: "json" })) || [];
  items = prune(items);
  const byDate = {};
  for (const it of items) (byDate[it.date] = byDate[it.date] || []).push(it);
  const packets = Object.keys(byDate).sort().map((d) => ({ _merge: true, date: d, items: byDate[d] }));
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
function prune(items) {
  const cutoff = Date.now() - 86400000 * MAX_AGE_DAYS;
  return items.filter((it) => {
    const t = Date.parse((it.date || "") + "T00:00:00Z");
    return isNaN(t) || t >= cutoff;
  });
}

export const config = { path: "/api/inbox" };
