// Cafe ordering server. No packages to install: just run "node server.js".
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const CHEF_PIN = process.env.CHEF_PIN || '6669';   // checked only on the server
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB = path.join(DATA_DIR, 'orders.json');
const STATUSES = ['new', 'preparing', 'ready', 'served', 'cancelled'];

fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { nextId: 1, orders: [] };
if (fs.existsSync(DB)) {
  try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); }
  catch { fs.copyFileSync(DB, DB + '.broken-' + Date.now()); console.log('orders.json was damaged; a backup copy was kept.'); }
}
const save = () => { fs.writeFileSync(DB + '.tmp', JSON.stringify(db)); fs.renameSync(DB + '.tmp', DB); };
// Read on every request, so menu edits show up after a page refresh.
const menu = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'menu.json'), 'utf8'));

const sessions = new Map();   // token -> expiry
const fails = new Map();      // ip -> {count, until}

function lanIP() {
  const list = Object.entries(os.networkInterfaces())
    .filter(([name]) => !/virtual|vmware|vbox|docker|wsl|vethernet|^utun|^tun/i.test(name))
    .flatMap(([, a]) => a).filter(a => a.family === 'IPv4' && !a.internal).map(a => a.address);
  return list.find(a => a.startsWith('192.168.')) || list[0];
}
function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 20000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
  });
}
const isChef = req => (sessions.get(req.headers['x-chef-token']) || 0) > Date.now();

async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/menu' && m === 'GET') return send(res, 200, menu());

  if (p === '/api/orders' && m === 'POST') {
    const b = await readBody(req), mn = menu(), table = Number(b.table);
    if (!Number.isInteger(table) || table < 1 || table > mn.tables) return send(res, 400, { error: 'Invalid table. Please scan the QR code on your table.' });
    const all = new Map(mn.categories.flatMap(c => c.items).map(i => [i.id, i]));
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) return send(res, 400, { error: 'Your cart is empty.' });
    const items = [];
    for (const line of b.items) {
      const it = line && all.get(line.id), qty = line && Number(line.qty);
      if (!it || !Number.isInteger(qty) || qty < 1 || qty > 20) return send(res, 400, { error: 'The menu has changed. Please refresh the page.' });
      items.push({ name: it.name, price: it.price, qty });   // price comes from the server, never the phone
    }
    const order = {
      id: db.nextId++, key: crypto.randomBytes(12).toString('hex'), table, items,
      note: String(b.note || '').slice(0, 200), total: items.reduce((s, i) => s + i.price * i.qty, 0),
      status: 'new', time: Date.now()
    };
    db.orders.push(order); save();
    return send(res, 201, { id: order.id, key: order.key, total: order.total });
  }

  // A customer can check the status of their own order using its private key.
  if (p === '/api/status' && m === 'GET') {
    const o = db.orders.find(o => o.key === url.searchParams.get('key'));
    return o ? send(res, 200, { id: o.id, status: o.status }) : send(res, 404, { error: 'Not found' });
  }

  if (p === '/api/chef/login' && m === 'POST') {
    const ip = req.socket.remoteAddress, f = fails.get(ip) || { count: 0, until: 0 };
    if (f.until > Date.now()) return send(res, 429, { error: 'Too many wrong tries. Wait 1 minute.' });
    const { pin } = await readBody(req);
    if (String(pin) !== CHEF_PIN) {
      f.count++; if (f.count >= 5) { f.count = 0; f.until = Date.now() + 60000; }
      fails.set(ip, f);
      return send(res, 401, { error: 'Wrong code' });
    }
    fails.delete(ip);
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, Date.now() + 12 * 3600 * 1000);
    return send(res, 200, { token });
  }

  if (p.startsWith('/api/chef/')) {
    if (!isChef(req)) return send(res, 401, { error: 'Please enter the code again.' });
    if (p === '/api/chef/orders' && m === 'GET') {
      return send(res, 200, { orders: db.orders.map(({ key, ...o }) => o), lanIP: lanIP() || null, port: PORT });
    }
    if (p === '/api/chef/status' && m === 'POST') {
      const b = await readBody(req), o = db.orders.find(o => o.id === b.id);
      if (!o || !STATUSES.includes(b.status)) return send(res, 400, { error: 'Bad request' });
      o.status = b.status; save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/chef/logout' && m === 'POST') { sessions.delete(req.headers['x-chef-token']); return send(res, 200, { ok: true }); }
  }
  send(res, 404, { error: 'Not found' });
}

const FILES = { '/': ['index.html', 'text/html'], '/chef': ['chef.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/qrcode.js': ['qrcode.js', 'text/javascript'] };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    return api(req, res, url).catch(e => { console.error(e.message); if (!res.headersSent) send(res, 400, { error: 'Something went wrong. Check menu.json if you just edited it.' }); });
  }
  const f = FILES[url.pathname];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': f[1] + '; charset=utf-8' });
  fs.createReadStream(path.join(PUBLIC, f[0])).pipe(res);
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Is the cafe server already running?` : e.message); process.exit(1); });
server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIP();
  console.log('\n  Cafe website is running. Keep this window open.\n');
  console.log(`  On this computer:  http://localhost:${PORT}`);
  if (ip) console.log(`  On phones (same Wi-Fi):  http://${ip}:${PORT}`);
  console.log('');
});
