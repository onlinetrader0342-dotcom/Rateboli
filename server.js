// RateBoli — backend
// Har user demand bhej sakta hai aur doosron ki demand par andhi boli (blind bid) laga sakta hai.
// Demand banane wale ko sirf SAB SE KAM rate nazar aata hai. Apni demand par khud boli nahi lag sakti.

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const db = new DatabaseSync(path.join(__dirname, 'data.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS demands (
  id TEXT PRIMARY KEY,
  shopkeeper_id TEXT NOT NULL,
  shopkeeper_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY,
  demand_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  rate REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(demand_id, supplier_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`);

// Purani DB (jahan role par pabandi thi) ko nayi scheme par lao — role ab koi pabandi nahi lagata
try {
  const userSql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'users'").get().sql || '';
  if (!userSql.includes("'member'")) {
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        token TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO users_new (id, name, phone, role, token, created_at)
        SELECT id, name, phone, 'member', token, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
    console.log('Purani database nayi scheme par update ho gayi.');
  }
} catch (e) { console.log('Migration note:', e.message); }

// Demands mein deadline/image columns (purani DBs ke liye)
try {
  const cols = db.prepare('PRAGMA table_info(demands)').all().map(c => c.name);
  if (!cols.includes('deadline')) db.exec("ALTER TABLE demands ADD COLUMN deadline TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('image')) db.exec("ALTER TABLE demands ADD COLUMN image TEXT NOT NULL DEFAULT ''");
} catch (e) { console.log('Migration note:', e.message); }

const now = () => new Date().toISOString();
const todayStr = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const uid = () => crypto.randomUUID();

// Product ki tasveer (optional) — data URL se file bana kar public/uploads mein save
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
function saveImage(dataUrl) {
  if (!dataUrl) return '';
  const m = /^data:(image\/(jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl).trim());
  if (!m) throw new Error('Tasveer ka format durust nahi (JPG, PNG, WebP ya GIF)');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 2.5 * 1024 * 1024) throw new Error('Tasveer 2.5MB se chhoti honi chahiye');
  if (!buf.length) throw new Error('Tasveer kharaab hai');
  const name = uid() + '.' + IMAGE_TYPES[m[1]];
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return name;
}

// Notification: DB mein save + realtime socket par bhej
function notify(userIds, text) {
  const ids = [...new Set(userIds)];
  if (!ids.length || !text) return;
  const t = now();
  const ins = db.prepare('INSERT INTO notifications (id, user_id, text, read, created_at) VALUES (?,?,?,?,?)');
  for (const u of ids) ins.run(uid(), u, text, 0, t);
  for (const u of ids) io.to('user:' + u).emit('notification', { text, at: t });
}

app.use(express.json({ limit: '10mb' })); // tasveeron ke liye bara limit
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Login zaroori hai' });
  const user = db.prepare('SELECT id, name, phone, role FROM users WHERE token = ?').get(token);
  if (!user) return res.status(401).json({ error: 'Session khatam ho gaya, dobara login karein' });
  req.user = user;
  next();
}
// Role ab koi pabandi nahi lagata — har user demand bhi bhej sakta hai aur boli bhi laga sakta hai.

// ---------- Account ----------
app.post('/api/register', (req, res) => {
  const { name, phone } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Apna naam likhein' });
  const ph = String(phone || '').replace(/\D/g, '');
  if (ph.length < 10 || ph.length > 13) return res.status(400).json({ error: 'Durust phone number likhein' });
  try {
    const u = { id: uid(), name: String(name).trim(), phone: ph, role: 'member', token: uid() + uid(), created_at: now() };
    db.prepare('INSERT INTO users (id,name,phone,role,token,created_at) VALUES (?,?,?,?,?,?)')
      .run(u.id, u.name, u.phone, u.role, u.token, u.created_at);
    res.json({ user: { id: u.id, name: u.name, phone: u.phone, role: u.role }, token: u.token });
  } catch (e) {
    if (String(e.message).includes('UNIQUE'))
      return res.status(400).json({ error: 'Ye number pehle se registered hai — login karein' });
    throw e;
  }
});

app.post('/api/login', (req, res) => {
  const ph = String((req.body || {}).phone || '').replace(/\D/g, '');
  const row = db.prepare('SELECT id, name, phone, role, token FROM users WHERE phone = ?').get(ph);
  if (!row) return res.status(404).json({ error: 'Ye number registered nahi — pehle account banayein' });
  res.json({ user: { id: row.id, name: row.name, phone: row.phone, role: row.role }, token: row.token });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

// ---------- Demands ----------
function demandSummary(d, user) {
  const bidCount = db.prepare('SELECT COUNT(*) AS c FROM bids WHERE demand_id = ?').get(d.id).c;
  const out = { ...d, bid_count: bidCount, is_mine: d.shopkeeper_id === user.id,
    expired: d.deadline ? todayStr() > d.deadline : false,
    image_url: d.image ? '/uploads/' + d.image : null };
  if (out.is_mine) {
    // Demand banane wale ko SIRF sab se kam boli nazar aati hai
    const low = db.prepare(
      `SELECT b.rate, b.supplier_name, u.phone AS supplier_phone
       FROM bids b JOIN users u ON u.id = b.supplier_id
       WHERE b.demand_id = ? ORDER BY b.rate ASC, b.created_at ASC LIMIT 1`
    ).get(d.id);
    out.lowest = low ? { rate: low.rate, supplier_name: low.supplier_name, supplier_phone: low.supplier_phone } : null;
  }
  const mine = db.prepare('SELECT rate FROM bids WHERE demand_id = ? AND supplier_id = ?').get(d.id, user.id);
  out.my_rate = mine ? mine.rate : null; // apni boli nazar aati hai, doosron ki nahi
  return out;
}

app.post('/api/demands', auth, (req, res) => {
  const { product_name, quantity, unit, note, deadline, items } = req.body || {};
  // Ek ya kayi products — har product ki ALAG demand banti hai
  // (taake har product ka apna sab se kam rate aur apna jeetne wala ho)
  let list;
  if (Array.isArray(items) && items.length) {
    list = items.map(it => ({
      product_name: String(it.product_name || '').trim(),
      quantity: Number(it.quantity),
      unit: String(it.unit || '').trim(),
      image: String(it.image || ''),
    }));
  } else {
    list = [{
      product_name: String(product_name || '').trim(),
      quantity: Number(quantity),
      unit: String(unit || '').trim(),
      image: '',
    }];
  }
  if (!list.length || list.length > 200)
    return res.status(400).json({ error: 'Ek saath zyada se zyada 200 products' });
  for (const it of list) {
    if (!it.product_name) return res.status(400).json({ error: 'Har product ka naam likhein' });
    if (!it.quantity || it.quantity <= 0)
      return res.status(400).json({ error: `"${it.product_name}" ki durust miqdar likhein` });
  }
  let dl = '';
  if (deadline) {
    dl = String(deadline);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dl) || isNaN(new Date(dl).getTime()))
      return res.status(400).json({ error: 'Aakhri tareekh durust nahi' });
    if (dl < todayStr()) return res.status(400).json({ error: 'Aakhri tareekh aaj ya aane wali honi chahiye' });
  }
  const noteStr = String(note || '').trim();
  let processed;
  try {
    processed = list.map(it => ({ ...it, image: saveImage(it.image) }));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const ins = db.prepare(`INSERT INTO demands
    (id,shopkeeper_id,shopkeeper_name,product_name,quantity,unit,note,deadline,image,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const made = processed.map(it => {
    const d = {
      id: uid(), shopkeeper_id: req.user.id, shopkeeper_name: req.user.name,
      product_name: it.product_name, quantity: it.quantity,
      unit: it.unit, note: noteStr,
      deadline: dl, image: it.image, status: 'open', created_at: now()
    };
    ins.run(d.id, d.shopkeeper_id, d.shopkeeper_name, d.product_name, d.quantity,
      d.unit, d.note, d.deadline, d.image, d.status, d.created_at);
    return d;
  });
  // Khud ke ilawa tamam users ko EK notification
  const others = db.prepare('SELECT id FROM users WHERE id != ?').all(req.user.id).map(r => r.id);
  const names = made.map(d => `${d.product_name} (${d.quantity}${d.unit ? ' ' + d.unit : ''})`).join(', ');
  const short = names.length > 120 ? names.slice(0, 117) + '...' : names;
  const dlTxt = dl ? ` — aakhri tareekh: ${dl}` : '';
  notify(others, made.length === 1
    ? `Nayi demand: ${short} — ${req.user.name}${dlTxt}`
    : `Nayi demands (${made.length}): ${short} — ${req.user.name}${dlTxt}`);
  const out = made.map(d => demandSummary(d, req.user));
  res.json({ demands: out, demand: out[0] });
});

app.get('/api/demands', auth, (req, res) => {
  // Apni tamam demands + doosron ki khuli demands
  const rows = db.prepare(
    "SELECT * FROM demands WHERE status = 'open' OR shopkeeper_id = ? ORDER BY created_at DESC"
  ).all(req.user.id);
  res.json({ demands: rows.map(d => demandSummary(d, req.user)) });
});

app.get('/api/demands/:id', auth, (req, res) => {
  const d = db.prepare('SELECT * FROM demands WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Demand nahi mili' });
  res.json({ demand: demandSummary(d, req.user) });
});

// ---------- Bids (andhi boli) ----------
app.post('/api/demands/:id/bids', auth, (req, res) => {
  const d = db.prepare('SELECT * FROM demands WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Demand nahi mili' });
  if (d.status !== 'open') return res.status(400).json({ error: 'Ye demand band ho chuki hai' });
  if (d.deadline && todayStr() > d.deadline)
    return res.status(400).json({ error: 'Is demand ki aakhri tareekh guzar chuki hai' });
  if (d.shopkeeper_id === req.user.id)
    return res.status(403).json({ error: 'Apni demand par khud boli nahi laga sakte' });
  const rate = Number((req.body || {}).rate);
  if (!rate || rate <= 0) return res.status(400).json({ error: 'Durust rate likhein' });
  db.prepare(`INSERT INTO bids (id, demand_id, supplier_id, supplier_name, rate, created_at)
              VALUES (?,?,?,?,?,?)
              ON CONFLICT(demand_id, supplier_id)
              DO UPDATE SET rate = excluded.rate, created_at = excluded.created_at`)
    .run(uid(), d.id, req.user.id, req.user.name, rate, now());
  const agg = db.prepare('SELECT MIN(rate) AS r, COUNT(*) AS c FROM bids WHERE demand_id = ?').get(d.id);
  notify([d.shopkeeper_id],
    `${d.product_name} par boli aayi — ab tak sab se kam: Rs ${agg.r} (kul boliyan: ${agg.c})`);
  res.json({ ok: true, my_rate: rate });
});

app.post('/api/demands/:id/close', auth, (req, res) => {
  const d = db.prepare('SELECT * FROM demands WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Demand nahi mili' });
  if (d.shopkeeper_id !== req.user.id) return res.status(403).json({ error: 'Ijazat nahi hai' });
  if (d.status !== 'open') return res.status(400).json({ error: 'Ye demand pehle se band hai' });
  db.prepare("UPDATE demands SET status = 'closed' WHERE id = ?").run(d.id);
  const bidders = db.prepare('SELECT supplier_id FROM bids WHERE demand_id = ?').all(d.id).map(r => r.supplier_id);
  const win = db.prepare(
    'SELECT supplier_id, rate FROM bids WHERE demand_id = ? ORDER BY rate ASC, created_at ASC LIMIT 1'
  ).get(d.id);
  if (win) {
    notify([win.supplier_id], `Mubarak! "${d.product_name}" ki demand aap ko mili — aap ki boli sab se kam thi: Rs ${win.rate}`);
    notify(bidders.filter(id => id !== win.supplier_id), `"${d.product_name}" ki demand band ho gayi hai.`);
  }
  res.json({ ok: true });
});

// ---------- Notifications ----------
app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare(
    'SELECT id, text, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(req.user.id);
  res.json({ notifications: rows });
});

app.post('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ---------- Realtime ----------
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const row = token ? db.prepare('SELECT id, role FROM users WHERE token = ?').get(token) : null;
  if (!row) return next(new Error('auth'));
  socket.data.user = row;
  next();
});
io.on('connection', (socket) => {
  socket.join('user:' + socket.data.user.id);
  socket.join('role:' + socket.data.user.role);
});

server.listen(PORT, () => console.log('RateBoli chal rahi hai: http://localhost:' + PORT));
