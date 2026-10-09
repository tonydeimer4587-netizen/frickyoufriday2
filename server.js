// Frick You Friday game server.
// Serves the game page and passes each player's moves to the other players in the same room.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PAGE = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/fyf-health')) {
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    return res.end('fyf-ok');
  }
  if (url === '/' || url.startsWith('/?') || url.startsWith('/index.html')) {
    fs.readFile(PAGE, (err, data) => {
      if (err) { res.writeHead(500); return res.end('index.html is missing next to server.js'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
});

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false, maxPayload: 32 * 1024 });
const rooms = new Map(); // room name -> Map(player id -> socket)

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const room = (params.get('room') || 'friday').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'friday';
  let players = rooms.get(room);
  if (!players) { players = new Map(); rooms.set(room, players); }
  if (players.size >= 8) { ws.close(1013, 'room full'); return; }

  const id = Math.random().toString(36).slice(2, 10);
  ws.id = id;
  ws.latest = { p: null, g: null };
  ws.alive = true;
  try { ws._socket.setNoDelay(true); } catch (e) {}

  // Tell the newcomer who is already here.
  ws.send(JSON.stringify({
    t: 'hello', id,
    others: [...players.values()].map(o => ({ id: o.id, p: o.latest.p, g: o.latest.g })),
  }));
  players.set(id, ws);

  ws.on('message', buf => {
    let m;
    try { m = JSON.parse(buf); } catch (e) { return; }
    if (!m || (m.t !== 'p' && m.t !== 'g')) return;
    ws.latest[m.t] = m.d;
    const out = JSON.stringify({ t: m.t, id, d: m.d });
    for (const other of players.values()) {
      if (other !== ws && other.readyState === 1) other.send(out);
    }
  });

  ws.on('pong', () => { ws.alive = true; });

  ws.on('close', () => {
    players.delete(id);
    const out = JSON.stringify({ t: 'leave', id });
    for (const other of players.values()) if (other.readyState === 1) other.send(out);
    if (!players.size) rooms.delete(room);
  });
});

// Drop connections that silently died (phone locked, lost signal).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 15000);

server.listen(PORT, () => console.log('Frick You Friday is running on port ' + PORT));
