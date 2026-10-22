/* Looping Louie relay: one Durable Object per room ("lobby", or a table code).
   It does what claude.ai's room capability does for the artifact: everyone in a
   room gets an id, sets one presence object, and hears everyone else's.
   Messages in:  {t:"p", p:{...}}            set my presence (the whole object)
                 "ping"                      answered "pong" without waking the object
   Messages out: {t:"welcome", id, peers:[{id, p}]}
                 {t:"peer", id, p}           someone joined (p null) or changed presence
                 {t:"left", id}
                 {t:"full"}                  room is full; the socket closes */
import { DurableObject } from "cloudflare:workers";

const ORIGINS = [/^https:\/\/paulbuettner-star\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const ROOM_RE = /^(lobby|louie-[a-z0-9]{4})$/;
const CAP = { lobby: 300, table: 12 };
const MAX_MSG = 16384;
const ATTACH_MAX = 1900;       // serializeAttachment holds 2 KB; bigger presences stay in memory only

export default {
  async fetch(req, env) {
    const m = new URL(req.url).pathname.match(/^\/r\/([a-z0-9-]{1,20})$/);
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
