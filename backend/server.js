const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// ─── IN-MEMORY STORES ────────────────────────────────────────────────────────
const users    = new Map();
const links    = new Map();
const txns     = new Map();
const parents  = new Map();
const sessions = new Map();

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function uid(prefix) { return prefix + '_' + crypto.randomBytes(4).toString('hex'); }
function now()       { return new Date().toISOString(); }

// ─── SEED DEMO DATA ──────────────────────────────────────────────────────────
users.set('u_adhil', {
  id: 'u_adhil', name: 'Adhil Rahman A', displayName: 'Adhil Designs',
  handle: '@adhil', phone: '9876543210', role: 'teen',
  parentId: 'p_parent1', walletBalance: 499,
  monthlyReceived: 2400, monthlyLimit: 5000,
  kycVerified: true, guardianApproved: true, createdAt: now()
});
parents.set('p_parent1', {
  id: 'p_parent1', name: 'Rahman A', phone: '9876543200',
  role: 'parent', teenId: 'u_adhil', notifications: [],
  settings: { perLinkLimit: 1000, dailyLimit: 2000, monthlyLimit: 5000,
    blockedCategories: ['adult','gambling','crypto','alcohol','weapons'] }
});
users.set('admin_1', { id: 'admin_1', name: 'Yungly Admin', role: 'admin' });

[
  { id:'txn_001', linkId:'lnk_001', amount:250, purpose:'Logo design',   from:'Rahul K',  to:'u_adhil', status:'success', createdAt: new Date(Date.now()-86400000*2).toISOString() },
  { id:'txn_002', linkId:'lnk_002', amount:150, purpose:'Reel edit',     from:'Priya M',  to:'u_adhil', status:'success', createdAt: new Date(Date.now()-86400000).toISOString()   },
  { id:'txn_003', linkId:'lnk_003', amount:99,  purpose:'Poster design', from:'Arjun S',  to:'u_adhil', status:'success', createdAt: now() }
].forEach(t => txns.set(t.id, t));

[
  { id:'lnk_001', creatorId:'u_adhil', displayName:'Adhil Designs', amount:250, purpose:'Logo design',   status:'paid', txnId:'txn_001', expiresAt: new Date(Date.now()+86400000*5).toISOString(), createdAt: new Date(Date.now()-86400000*2).toISOString() },
  { id:'lnk_002', creatorId:'u_adhil', displayName:'Adhil Designs', amount:150, purpose:'Reel edit',     status:'paid', txnId:'txn_002', expiresAt: new Date(Date.now()+86400000*4).toISOString(), createdAt: new Date(Date.now()-86400000).toISOString()   },
  { id:'lnk_003', creatorId:'u_adhil', displayName:'Adhil Designs', amount:99,  purpose:'Poster design', status:'paid', txnId:'txn_003', expiresAt: new Date(Date.now()+86400000*6).toISOString(), createdAt: now() }
].forEach(l => links.set(l.id, l));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, time: now() }));

// ─── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { role } = req.body;
  let user = role === 'admin' ? users.get('admin_1')
           : role === 'parent' ? parents.get('p_parent1')
           : users.get('u_adhil');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ token: 'demo_token_' + user.id, user });
});

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
app.post('/api/onboard', (req, res) => {
  const { phone, password, name, displayName, parentPhone } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'Missing fields' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const sessionId    = uid('sess');
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  const session = {
    sessionId, phone, passwordHash, name,
    displayName: displayName || name.split(' ')[0] + ' Creations',
    parentPhone: parentPhone || '',
    balance: 0, monthlyReceived: 0, monthlyLimit: 5000,
    links: [], txns: [], createdAt: now()
  };
  sessions.set(sessionId, session);
  res.json({ ok: true, sessionId, user: session });
});

// ─── SESSIONS ─────────────────────────────────────────────────────────────────
app.get('/api/session/:sessionId', (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(s);
});

app.post('/api/session/:sessionId/paylinks', (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const { amount, purpose, note, expiryDays } = req.body;
  if (!purpose || !amount) return res.status(400).json({ error: 'Missing purpose or amount' });
  const id   = uid('lnk');
  const link = {
    id, amount: +amount, purpose, note: note || '',
    displayName: s.displayName, status: 'active', txnId: null,
    expiresAt: new Date(Date.now() + (expiryDays||7)*86400000).toISOString(),
    createdAt: now()
  };
  s.links.unshift(link);
  sessions.set(s.sessionId, s);
  res.json({ link, payUrl: `https://yungly-paylink-production.up.railway.app/pay/${id}` });
});

app.get('/api/session/:sessionId/paylinks', (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(s.links);
});

app.post('/api/session/:sessionId/pay/:linkId/confirm', (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const link = s.links.find(l => l.id === req.params.linkId);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const { customerName, paymentMethod } = req.body;
  const txnId = uid('txn');
  const txn   = {
    id: txnId, linkId: link.id, amount: link.amount,
    purpose: link.purpose, from: customerName || 'Customer',
    paymentMethod: paymentMethod || 'UPI',
    status: 'success', createdAt: now()
  };
  link.status = 'paid';
  link.txnId  = txnId;
  s.txns.unshift(txn);
  s.balance         += link.amount;
  s.monthlyReceived += link.amount;
  sessions.set(s.sessionId, s);
  res.json({ txn, session: s });
});

// ─── PAYLINKS ─────────────────────────────────────────────────────────────────
app.get('/api/paylinks', (req, res) => {
  const { creatorId } = req.query;
  const result = [...links.values()]
    .filter(l => l.creatorId === creatorId)
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(result);
});

app.post('/api/paylinks', (req, res) => {
  const { creatorId, amount, purpose, note, expiryDays } = req.body;
  const user = users.get(creatorId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const id   = uid('lnk');
  const link = {
    id, creatorId, displayName: user.displayName,
    amount: Number(amount), purpose, note: note || '',
    status: 'active', txnId: null,
    expiresAt: new Date(Date.now() + (expiryDays||7)*86400000).toISOString(),
    createdAt: now()
  };
  links.set(id, link);
  res.json({ link, payUrl: `https://yungly-paylink-production.up.railway.app/pay/${id}` });
});

app.get('/api/paylinks/:id', (req, res) => {
  const link = links.get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const creator = users.get(link.creatorId);
  res.json({ link, creator: creator ? { displayName: creator.displayName, handle: creator.handle, kycVerified: creator.kycVerified } : null });
});

app.delete('/api/paylinks/:id', (req, res) => {
  const link = links.get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Not found' });
  link.status = 'cancelled';
  links.set(link.id, link);
  res.json({ ok: true });
});

// ─── PAYMENT ──────────────────────────────────────────────────────────────────
app.post('/api/pay/:linkId/confirm', (req, res) => {
  const link = links.get(req.params.linkId);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const { customerName, paymentMethod } = req.body;
  const txnId = uid('txn');
  const txn   = {
    id: txnId, linkId: link.id, amount: link.amount,
    purpose: link.purpose, from: customerName || 'Customer',
    to: link.creatorId, paymentMethod: paymentMethod || 'UPI',
    status: 'success', createdAt: now()
  };
  txns.set(txnId, txn);
  link.status = 'paid';
  link.txnId  = txnId;
  links.set(link.id, link);
  const creator = users.get(link.creatorId);
  if (creator) {
    creator.walletBalance     += link.amount;
    creator.monthlyReceived   += link.amount;
    users.set(creator.id, creator);
    const parent = parents.get(creator.parentId);
    if (parent) {
      parent.notifications.unshift({
        id: uid('notif'), type: 'payment_received',
        message: `${creator.displayName} received ₹${link.amount} for "${link.purpose}" from ${txn.from}`,
        txnId, amount: link.amount, createdAt: now(), read: false
      });
      parents.set(parent.id, parent);
    }
  }
  res.json({ txn, receipt: { txnId, amount: link.amount, purpose: link.purpose, from: txn.from, date: txn.createdAt } });
});

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
app.get('/api/transactions', (req, res) => {
  const { userId } = req.query;
  const result = [...txns.values()]
    .filter(t => t.to === userId)
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(result);
});

// ─── PARENT ───────────────────────────────────────────────────────────────────
app.get('/api/parent/:parentId', (req, res) => {
  const parent = parents.get(req.params.parentId);
  if (!parent) return res.status(404).json({ error: 'Not found' });
  const teen = users.get(parent.teenId);
  res.json({ parent, teen });
});

app.patch('/api/parent/:parentId/settings', (req, res) => {
  const parent = parents.get(req.params.parentId);
  if (!parent) return res.status(404).json({ error: 'Not found' });
  parent.settings = { ...parent.settings, ...req.body };
  parents.set(parent.id, parent);
  res.json({ ok: true, settings: parent.settings });
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────
app.get('/api/admin/stats', (req, res) => {
  const allTxns  = [...txns.values()];
  const allLinks = [...links.values()];
  const totalVolume = allTxns.filter(t=>t.status==='success').reduce((s,t)=>s+t.amount, 0);
  res.json({
    totalUsers:  users.size - 1,
    totalLinks:  allLinks.length,
    activeLinks: allLinks.filter(l=>l.status==='active').length,
    totalTxns:   allTxns.length,
    totalVolume,
    successRate: allTxns.length ? Math.round(allTxns.filter(t=>t.status==='success').length / allTxns.length * 100) : 0
  });
});

app.get('/api/admin/users', (req, res) => {
  res.json([...users.values()].filter(u => u.role === 'teen'));
});

app.get('/api/admin/transactions', (req, res) => {
  res.json([...txns.values()].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

// ─── CATCH-ALL (must be last) ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Yungly backend running on port ${PORT}`));
