/* Looping Louie relay: one Durable Object per room ("lobby", or a table code).
   It does what claude.ai's room capability does for the artifact: everyone in a
   room gets an id, sets one presence object, and hears everyone else's.
   Messages in:  {t:"p", p:{...}}            set my presence (the whole object)
                 "ping"                      answered "pong" without waking the object
   Messages out: {t:"welcome", id, peers:[{id, p}]}
                 {t:"peer", id, p}           someone joined (p null) or changed presence
                 {t:"left", id}
                 {t:"full"}                  room is full; the socket closes
   It also keeps the play records (see stats() below). */
import { DurableObject } from "cloudflare:workers";

const ORIGINS = [/^https:\/\/paulbuettner-star\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const ROOM_RE = /^(lobby|louie-[a-z0-9]{4})$/;
const CAP = { lobby: 300, table: 12 };
const MAX_MSG = 16384;
const ATTACH_MAX = 1900;       // serializeAttachment holds 2 KB; bigger presences stay in memory only

/* Play records: one anonymous row per game and device in the D1 database STATS (schema in migrations/).
   POST /s/game  {v, mode, place, seq, prev, table, speed, humans, remotes, cpus, levels, touch, lang, screen}  ->  {id}
   POST /s/end   {id, ended, result, gameS, realS, knockouts, replays, skips, items: [mushrooms, hearts, hats, lotus], missed, missedS}
   POST /s/rate  {id, stars?, feedback?}  (for a day after the game)
   Bodies are text/plain JSON, so browsers send them without a preflight. No names, no IP address and no device id
   are stored; the address only counts requests in memory, to stop one sender flooding the table. */
const STATS_MAX = 4096;
const STATS_PER_MIN = 40;
const recent = new Map();      // address -> [minute, requests]; this isolate only, never stored
const pick = (x, list) => (list.includes(x) ? x : null);
const count = (x, hi) => (Number.isInteger(x) && x >= 0 && x <= hi ? x : null);
const secs = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x < 86400 ? Math.round(x * 10) / 10 : null);
const text = (x, n, re) => (typeof x === "string" && x.length <= n && (!re || re.test(x)) ? x : null);

async function stats(req, env, what) {
  const origin = req.headers.get("Origin") || "";
  if (!ORIGINS.some((re) => re.test(origin))) return new Response("Forbidden\n", { status: 403 });
  const cors = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
  const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST" || !env.STATS) return json({ ok: false }, 405);
  const ip = req.headers.get("CF-Connecting-IP") || "", minute = Math.floor(Date.now() / 60000), r = recent.get(ip);
  if (r && r[0] === minute && r[1] >= STATS_PER_MIN) return json({ ok: false }, 429);
  recent.set(ip, r && r[0] === minute ? [minute, r[1] + 1] : [minute, 1]);
  if (recent.size > 5000) recent.clear();
  const raw = await req.text();
  if (raw.length > STATS_MAX) return json({ ok: false }, 413);
  let b = null;
  try { b = JSON.parse(raw); } catch (e) { /* not JSON */ }
  if (!b || typeof b !== "object" || Array.isArray(b)) return json({ ok: false }, 400);
  const now = new Date().toISOString();
  try {
    if (what === "game") {
      const id = crypto.randomUUID().replace(/-/g, "");
      await env.STATS.prepare(
        "INSERT INTO games (id, created, v, mode, place, seq, prev, tbl, speed, humans, remotes, cpus, levels, touch, lang, screen) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
      ).bind(id, now, text(b.v, 12, /^v\d+$/), pick(b.mode, ["normal", "aquigai"]), pick(b.place, ["local", "host", "guest"]),
        count(b.seq, 999), pick(b.prev, ["normal", "aquigai"]),
        text(b.table, 10, /^(louie-[a-z0-9]{4})?$/), pick(b.speed, ["chill", "normal", "wild"]), count(b.humans, 4), count(b.remotes, 4), count(b.cpus, 4),
        text(b.levels, 40, /^((easy|normal|hard)(,(easy|normal|hard)){0,3})?$/), b.touch === true ? 1 : b.touch === false ? 0 : null,
        text(b.lang, 2, /^[a-z]{0,2}$/), pick(b.screen, ["phone", "tablet", "desktop"])).run();
      return json({ id });
    }
    const id = text(b.id, 32, /^[0-9a-f]{32}$/);
    if (!id) return json({ ok: false }, 400);
    if (what === "end") {
      const it = Array.isArray(b.items) ? b.items : [];
      await env.STATS.prepare(
        "UPDATE games SET ended = ?2, result = ?3, game_s = ?4, real_s = ?5, knockouts = ?6, replays = ?7, skips = ?8, mushrooms = ?9, hearts = ?10, hats = ?11, lotus = ?12, missed = ?13, missed_s = ?14, ended_at = ?15 WHERE id = ?1 AND ended IS NULL",
      ).bind(id, pick(b.ended, ["won", "left", "closed"]), pick(b.result, ["you", "other", "cpu", "louie"]), secs(b.gameS), secs(b.realS),
        count(b.knockouts, 4), count(b.replays, 99), count(b.skips, 99), count(it[0], 99), count(it[1], 99), count(it[2], 99), count(it[3], 99),
        pick(b.missed, ["mushroom", "heart", "hat", "lotus"]), b.missed ? secs(b.missedS) : null, now).run();
      return json({ ok: true });
    }
    const stars = b.stars == null ? null : count(b.stars, 5) || null;
    const feedback = typeof b.feedback === "string" ? b.feedback.trim().slice(0, 500) : null;
    await env.STATS.prepare(
      "UPDATE games SET stars = COALESCE(?2, stars), feedback = COALESCE(?3, feedback), rated_at = ?4 WHERE id = ?1 AND created > ?5",
    ).bind(id, stars, feedback, now, new Date(Date.now() - 864e5).toISOString()).run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false }, 500);   // the records are a nice-to-have: never let them get in the way of a game
  }
}

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname, s = path.match(/^\/s\/(game|end|rate)$/);
    if (s) return stats(req, env, s[1]);
    const m = path.match(/^\/r\/([a-z0-9-]{1,20})$/);
    if (!m || !ROOM_RE.test(m[1])) return new Response("Looping Louie relay\n", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket\n", { status: 426 });
    if (!ORIGINS.some((re) => re.test(req.headers.get("Origin") || ""))) return new Response("Forbidden\n", { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.big = new Map();      // id -> presence too big for the socket attachment
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  peerOf(ws) {
    const a = ws.deserializeAttachment();
    if (!a || a.gone) return null;
    return { id: a.id, p: a.big ? this.big.get(a.id) || null : a.p };
  }
  async fetch(req) {
    const name = new URL(req.url).pathname.slice(3);
    const socks = this.ctx.getWebSockets();
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    if (socks.length >= (name === "lobby" ? CAP.lobby : CAP.table)) {
      server.send(JSON.stringify({ t: "full" }));
      server.close(1013, "full");
      return new Response(null, { status: 101, webSocket: client });
    }
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    server.serializeAttachment({ id, p: null });
    const peers = socks.map((ws) => this.peerOf(ws)).filter(Boolean);
    server.send(JSON.stringify({ t: "welcome", id, peers }));
    this.broadcast(server, { t: "peer", id, p: null });
    return new Response(null, { status: 101, webSocket: client });
  }
  broadcast(from, msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from) continue;
      try { ws.send(s); } catch (e) { /* closing */ }
    }
  }
  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX_MSG) return;
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || m.t !== "p" || !m.p || typeof m.p !== "object" || Array.isArray(m.p)) return;
    const a = ws.deserializeAttachment();
    if (!a) return;
    const s = JSON.stringify(m.p);
    if (s.length <= ATTACH_MAX) { this.big.delete(a.id); ws.serializeAttachment({ id: a.id, p: m.p }); }
    else { this.big.set(a.id, m.p); ws.serializeAttachment({ id: a.id, big: true }); }
    this.broadcast(ws, { t: "peer", id: a.id, p: m.p });
  }
  gone(ws) {
    const a = ws.deserializeAttachment();
    if (!a || a.gone) return;
    ws.serializeAttachment({ id: a.id, gone: true });
    this.big.delete(a.id);
    this.broadcast(ws, { t: "left", id: a.id });
  }
  async webSocketClose(ws) { this.gone(ws); try { ws.close(); } catch (e) { /* already closed */ } }
  async webSocketError(ws) { this.gone(ws); }
}
