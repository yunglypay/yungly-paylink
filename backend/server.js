const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// ─── IN-MEMORY STORE (replace with DB in prod) ───────────────────────────────
const users   = new Map(); // userId → user object
const links   = new Map(); // linkId → paylink object
const txns    = new Map(); // txnId  → transaction object
const parents = new Map(); // parentId → parent object

// ─── SEED DEMO DATA ──────────────────────────────────────────────────────────
const seedTeen = {
  id: 'u_adhil',
  name: 'Adhil Rahman A',
  displayName: 'Adhil Designs',
  handle: '@adhil',
  phone: '9876543210',
  role: 'teen',
  parentId: 'p_parent1',
  walletBalance: 499,
  monthlyReceived: 2400,
  monthlyLimit: 5000,
  kycVerified: true,
  guardianApproved: true,
  createdAt: new Date().toISOString()
};

const seedParent = {
  id: 'p_parent1',
  name: 'Rahman A',
  phone: '9876543200',
  role: 'parent',
  teenId: 'u_adhil',
  notifications: [],
  settings: { perLinkLimit: 1000, dailyLimit: 2000, monthlyLimit: 5000, blockedCategories: ['adult','gambling','crypto','alcohol','weapons'] }
};

const seedAdmin = {
  id: 'admin_1',
  name: 'Yungly Admin',
  role: 'admin'
};

users.set('u_adhil', seedTeen);
parents.set('p_parent1', seedParent);
users.set('admin_1', seedAdmin);

// seed some transactions
const seedTxns = [
  { id: 'txn_001', linkId: 'lnk_001', amount: 250, purpose: 'Logo design', from: 'Rahul K', to: 'u_adhil', status: 'success', createdAt: new Date(Date.now()-86400000*2).toISOString() },
  { id: 'txn_002', linkId: 'lnk_002', amount: 150, purpose: 'Reel edit', from: 'Priya M', to: 'u_adhil', status: 'success', createdAt: new Date(Date.now()-86400000).toISOString() },
  { id: 'txn_003', linkId: 'lnk_003', amount: 99,  purpose: 'Poster design', from: 'Arjun S', to: 'u_adhil', status: 'success', createdAt: new Date().toISOString() }
];
seedTxns.forEach(t => txns.set(t.id, t));

const seedLinks = [
  { id: 'lnk_001', creatorId: 'u_adhil', displayName: 'Adhil Designs', amount: 250, purpose: 'Logo design', status: 'paid', txnId: 'txn_001', expiresAt: new Date(Date.now()+86400000*5).toISOString(), createdAt: new Date(Date.now()-86400000*2).toISOString() },
  { id: 'lnk_002', creatorId: 'u_adhil', displayName: 'Adhil Designs', amount: 150, purpose: 'Reel edit', status: 'paid', txnId: 'txn_002', expiresAt: new Date(Date.now()+86400000*4).toISOString(), createdAt: new Date(Date.now()-86400000).toISOString() },
  { id: 'lnk_003', creatorId: 'u_adhil', displayName: 'Adhil Designs', amount: 99,  purpose: 'Poster design', status: 'paid', txnId: 'txn_003', expiresAt: new Date(Date.now()+86400000*6).toISOString(), createdAt: new Date().toISOString() }
];
seedLinks.forEach(l => links.set(l.id, l));

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function uid(prefix) { return prefix + '_' + crypto.randomBytes(4).toString('hex'); }
function now() { return new Date().toISOString(); }

// ─── AUTH (simplified — swap with JWT in prod) ────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { phone, role } = req.body;
  // Demo: any phone logs in; role determines account
  let user = null;
  if (role === 'admin') user = users.get('admin_1');
  else if (role === 'parent') user = parents.get('p_parent1');
  else user = users.get('u_adhil');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ token: 'demo_token_' + user.id, user });
});

// ─── TEEN: PAYLINK CRUD ───────────────────────────────────────────────────────
app.post('/api/paylinks', (req, res) => {
  const { creatorId, amount, purpose, note, expiryDays } = req.body;
  const user = users.get(creatorId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // limit checks
  const parent = parents.get(user.parentId);
  if (parent && amount > parent.settings.perLinkLimit)
    return res.status(400).json({ error: `Amount exceeds per-link limit of ₹${parent.settings.perLinkLimit}` });

  const id = uid('lnk');
  const link = {
    id, creatorId,
    displayName: user.displayName,
    handle: user.handle,
    amount: Number(amount),
    purpose, note,
    status: 'active',
    txnId: null,
    expiresAt: new Date(Date.now() + (expiryDays||7)*86400000).toISOString(),
    createdAt: now()
  };
  links.set(id, link);
  res.json({ link, payUrl: `http://localhost:3000/pay/${id}` });
});

app.get('/api/paylinks', (req, res) => {
  const { creatorId } = req.query;
  const result = [...links.values()].filter(l => l.creatorId === creatorId)
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(result);
});

app.get('/api/paylinks/:id', (req, res) => {
  const link = links.get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const creator = users.get(link.creatorId);
  res.json({ link, creator: { displayName: creator.displayName, handle: creator.handle, kycVerified: creator.kycVerified } });
});

app.delete('/api/paylinks/:id', (req, res) => {
  const link = links.get(req.params.id);
  if (!link) return res.status(404).json({ error: 'Not found' });
  link.status = 'cancelled';
  links.set(link.id, link);
  res.json({ ok: true });
});

// ─── CUSTOMER: PAYMENT ────────────────────────────────────────────────────────
app.post('/api/pay/:linkId/initiate', (req, res) => {
  const link = links.get(req.params.linkId);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  if (link.status !== 'active') return res.status(400).json({ error: 'Link is ' + link.status });
  if (new Date(link.expiresAt) < new Date()) return res.status(400).json({ error: 'Link expired' });

  // Mock Razorpay order
  const razorpayOrderId = 'order_' + crypto.randomBytes(6).toString('hex');
  res.json({
    orderId: razorpayOrderId,
    amount: link.amount * 100, // paise
    currency: 'INR',
    key: 'rzp_test_YourKeyHere', // swap with real key
    name: 'Yungly Pay',
    description: link.purpose,
    prefill: { name: req.body.customerName || '', email: req.body.email || '' }
  });
});

app.post('/api/pay/:linkId/confirm', (req, res) => {
  const link = links.get(req.params.linkId);
  if (!link) return res.status(404).json({ error: 'Link not found' });

  const { customerName, paymentMethod, razorpayPaymentId } = req.body;

  // In prod: verify Razorpay signature here
  const txnId = uid('txn');
  const txn = {
    id: txnId,
    linkId: link.id,
    amount: link.amount,
    purpose: link.purpose,
    from: customerName || 'Customer',
    to: link.creatorId,
    paymentMethod: paymentMethod || 'UPI',
    razorpayPaymentId: razorpayPaymentId || 'pay_mock_' + Date.now(),
    status: 'success',
    createdAt: now()
  };
  txns.set(txnId, txn);

  // update link
  link.status = 'paid';
  link.txnId = txnId;
  links.set(link.id, link);

  // update creator wallet
  const creator = users.get(link.creatorId);
  creator.walletBalance += link.amount;
  creator.monthlyReceived += link.amount;
  users.set(creator.id, creator);

  // notify parent
  const parent = parents.get(creator.parentId);
  if (parent) {
    parent.notifications.unshift({
      id: uid('notif'),
      type: 'payment_received',
      message: `${creator.displayName} received ₹${link.amount} for "${link.purpose}" from ${txn.from}`,
      txnId, amount: link.amount,
      createdAt: now(), read: false
    });
    parents.set(parent.id, parent);
  }

  res.json({ txn, receipt: { txnId, amount: link.amount, purpose: link.purpose, from: txn.from, to: creator.displayName, date: txn.createdAt } });
});

// ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
app.get('/api/transactions', (req, res) => {
  const { userId } = req.query;
  const result = [...txns.values()].filter(t => t.to === userId)
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(result);
});

app.get('/api/transactions/:id', (req, res) => {
  const txn = txns.get(req.params.id);
  if (!txn) return res.status(404).json({ error: 'Not found' });
  res.json(txn);
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

app.patch('/api/parent/:parentId/notifications/read', (req, res) => {
  const parent = parents.get(req.params.parentId);
  if (!parent) return res.status(404).json({ error: 'Not found' });
  parent.notifications.forEach(n => n.read = true);
  parents.set(parent.id, parent);
  res.json({ ok: true });
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────
app.get('/api/admin/stats', (req, res) => {
  const allTxns = [...txns.values()];
  const allLinks = [...links.values()];
  const totalVolume = allTxns.filter(t=>t.status==='success').reduce((s,t)=>s+t.amount,0);
  res.json({
    totalUsers: users.size - 1,
    totalLinks: allLinks.length,
    activeLinks: allLinks.filter(l=>l.status==='active').length,
    totalTxns: allTxns.length,
    totalVolume,
    successRate: allTxns.length ? Math.round(allTxns.filter(t=>t.status==='success').length/allTxns.length*100) : 0,
    recentTxns: allTxns.slice(0,5),
    recentLinks: allLinks.slice(0,5)
  });
});

app.get('/api/admin/users', (req, res) => {
  res.json([...users.values()].filter(u=>u.role==='teen'));
});

app.get('/api/admin/transactions', (req, res) => {
  res.json([...txns.values()].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
});


// ─── OTP + ONBOARDING ────────────────────────────────────────────────────────
const sessions = new Map();

app.post('/api/onboard', (req, res) => {
  const { phone, password, name, displayName, parentPhone } = req.body;
  if (!phone || !name) return res.status(400).json({ error: 'Missing fields' });
  const sessionId = uid('sess');
  const session = {
    sessionId, phone, name,
    displayName: displayName || name.split(' ')[0] + ' Creations',
    parentPhone: parentPhone || '',
    balance: 0, monthlyReceived: 0, monthlyLimit: 5000,
    links: [], txns: [], createdAt: now()
  };
  sessions.set(sessionId, session);
  res.json({ ok: true, sessionId, user: session });
});

app.get('/api/session/:sessionId', (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(s);
});

app.post('/api/session/:sessionId/paylinks', (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const { amount, purpose, note, expiryDays } = req.body;
  if (!purpose || !amount) return res.status(400).json({ error: 'Missing fields' });
  const id = uid('lnk');
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

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Yungly PayLink backend running on port ' + PORT));
