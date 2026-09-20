const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 10000;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'https://edielrodrigues.github.io').replace(/\/$/, '');
const MP_TOKEN = process.env.MERCADO_PAGO_ACCESS_TOKEN || '';
const MP_PUBLIC_KEY = process.env.MERCADO_PAGO_PUBLIC_KEY || '';
const MP_WEBHOOK_SECRET = process.env.MERCADO_PAGO_WEBHOOK_SECRET || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'diel_zi_nho25@hotmail.com').trim().toLowerCase();

if (!admin.apps.length) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
  } catch (e) {
    console.error('FIREBASE_SERVICE_ACCOUNT_JSON inválido');
  }
  if (serviceAccount.project_id) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://balanco-roupas-eeead-default-rtdb.firebaseio.com'
    });
  }
}

const db = () => admin.apps.length ? admin.database() : null;
const normalizeEmail = v => String(v || '').trim().toLowerCase();
const isAdmin = user => !!user && normalizeEmail(user.email) === ADMIN_EMAIL;

// CORS: não deixa qualquer site arbitrário usar a API.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = !origin || origin === FRONTEND_URL || origin === 'https://edielrodrigues.github.io' || origin === 'http://localhost:3000' || origin === 'http://localhost:5173';
  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (!allowed) return res.status(403).json({ message: 'Origem não autorizada.' });
  next();
});

app.use(express.json({ limit: '1mb' }));

async function requireAuth(req, res, next) {
  try {
    if (!admin.apps.length) return res.status(503).json({ message: 'Firebase Admin não configurado no Render.' });
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) return res.status(401).json({ message: 'Autenticação obrigatória.' });
    const token = header.slice(7).trim();
    if (!token) return res.status(401).json({ message: 'Token de autenticação ausente.' });
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (e) {
    console.error('Auth:', e.message);
    return res.status(401).json({ message: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

async function mp(pathname, options = {}) {
  if (!MP_TOKEN) throw new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado no Render');
  const r = await fetch('https://api.mercadopago.com' + pathname, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + MP_TOKEN,
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    const e = new Error(data.message || data.error || `Mercado Pago HTTP ${r.status}`);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

function appUrl(req) { return FRONTEND_URL || `${req.protocol}://${req.get('host')}`; }
function externalRef(userId, plan) { return `CDP-${plan}-${userId}-${Date.now()}`; }
function checkoutUrl(data) { return String(data?.init_point || data?.sandbox_init_point || '').trim(); }

async function getPrice(plan) {
  const s = db();
  if (!s) throw new Error('Firebase Admin não configurado');
  const snap = await s.ref('course/settings').once('value');
  const v = snap.val() || { vipPrice: 150, lifePrice: 299.99 };
  const price = Number(plan === 'vip' ? v.vipPrice : v.lifePrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Preço do plano inválido');
  return price;
}

async function getUser(uid) {
  const d = db();
  if (!d) throw new Error('Firebase Admin não configurado');
  const snap = await d.ref('course/users/' + uid).once('value');
  return snap.val() || {};
}

async function savePaymentUser(userId, data) {
  const d = db();
  if (!d) throw new Error('Firebase Admin não configurado');
  await d.ref('course/users/' + userId).update(data);
}

function parsePaymentReference(ref) {
  const m = String(ref || '').match(/^CDP-(vip|life)-(.+)-(\d{10,})$/);
  return m ? { plan: m[1], userId: m[2], createdAt: Number(m[3]) } : null;
}

function parseSubscriptionReference(ref) {
  const m = String(ref || '').match(/^CDP-vip-(.+)-(\d{10,})$/);
  return m ? { userId: m[1], createdAt: Number(m[2]) } : null;
}

function safeEqualHex(a, b) {
  try {
    const aa = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
  } catch { return false; }
}

function verifyWebhook(req) {
  if (!MP_WEBHOOK_SECRET) return true;
  const sig = req.get('x-signature') || '';
  const requestId = req.get('x-request-id') || '';
  const dataId = String(req.body?.data?.id || '');
  const ts = (sig.match(/(?:^|,)ts=([^,]+)/) || [])[1];
  const v1 = (sig.match(/(?:^|,)v1=([^,]+)/) || [])[1];
  if (!ts || !v1 || !dataId) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const h = crypto.createHmac('sha256', MP_WEBHOOK_SECRET).update(manifest).digest('hex');
  return safeEqualHex(h, v1);
}

app.get('/health', (req, res) => res.json({
  online: true,
  service: 'Curso da Passada Payments',
  version: '12.0.0-secure',
  mercadoPagoConfigured: !!MP_TOKEN,
  mercadoPagoPublicKeyConfigured: !!MP_PUBLIC_KEY,
  firebaseConfigured: !!db(),
  adminEmail: ADMIN_EMAIL
}));

app.get('/payments/config', (req, res) => res.json({ publicKey: MP_PUBLIC_KEY }));

// Cria uma referência de pagamento somente para o usuário autenticado.
app.post('/payments/create', requireAuth, async (req, res) => {
  try {
    if (!MP_TOKEN || !db()) return res.status(503).json({ message: 'Backend ainda não configurado no Render.' });
    const { plan } = req.body || {};
    if (!['vip', 'life'].includes(plan)) return res.status(400).json({ message: 'Plano inválido.' });

    const uid = req.user.uid;
    const email = normalizeEmail(req.user.email);
    const price = await getPrice(plan);
    const ref = externalRef(uid, plan);
    await savePaymentUser(uid, { pendingPlan: plan, pendingReference: ref, pendingAmount: price, pendingCreatedAt: Date.now() });
    res.json({ ok: true, plan, amount: price, reference: ref, email });
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({ message: e.message || 'Erro ao preparar pagamento.' });
  }
});

app.post('/payments/process', requireAuth, async (req, res) => {
  try {
    if (!MP_TOKEN || !db()) return res.status(503).json({ message: 'Backend ainda não configurado no Render.' });
    const { plan, payment, selectedPaymentMethod, reference } = req.body || {};
    if (!['vip', 'life'].includes(plan) || !payment) return res.status(400).json({ message: 'Dados do pagamento incompletos.' });

    const uid = req.user.uid;
    const email = normalizeEmail(req.user.email);
    const user = await getUser(uid);
    const ref = String(reference || '').trim();
    if (!ref || user.pendingReference !== ref || user.pendingPlan !== plan) {
      return res.status(400).json({ message: 'Referência de pagamento inválida ou expirada. Inicie o pagamento novamente.' });
    }

    const parsed = parsePaymentReference(ref);
    if (!parsed || parsed.userId !== uid || parsed.plan !== plan) return res.status(400).json({ message: 'Referência de pagamento inválida.' });
    if (Date.now() - parsed.createdAt > 30 * 60 * 1000) return res.status(400).json({ message: 'Sessão de pagamento expirada. Inicie novamente.' });

    const price = await getPrice(plan);
    const method = String(payment.payment_method_id || selectedPaymentMethod || '').toLowerCase();
    if (!method) return res.status(400).json({ message: 'Forma de pagamento não identificada.' });

    const payer = { email };
    if (payment.payer?.identification?.type && payment.payer?.identification?.number) payer.identification = payment.payer.identification;
    if (payment.payer?.first_name) payer.first_name = payment.payer.first_name;
    if (payment.payer?.last_name) payer.last_name = payment.payer.last_name;

    // VIP no cartão: assinatura recorrente. A data inicial fica deliberadamente no futuro
    // para evitar o erro auto_recurring.start_date em horário já passado.
    if (plan === 'vip' && method !== 'pix' && method !== 'pix_bank_transfer') {
      if (!payment.token) return res.status(400).json({ message: 'Não foi possível tokenizar o cartão. Tente novamente.' });
      const start = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const sub = await mp('/preapproval', {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Curso da Passada — Plano VIP',
          external_reference: ref,
          payer_email: email,
          card_token_id: payment.token,
          auto_recurring: { frequency: 1, frequency_type: 'months', start_date: start, transaction_amount: price, currency_id: 'BRL' },
          back_url: FRONTEND_URL || appUrl(req)
        })
      });
      await savePaymentUser(uid, { pendingPlan: 'vip', pendingReference: ref, subscriptionId: String(sub.id), lastSubscriptionStatus: sub.status || 'pending' });
      if (sub.status === 'authorized') await processSubscription(String(sub.id));
      return res.json({ ok: true, type: 'subscription', id: String(sub.id), status: sub.status || 'pending', message: 'Assinatura VIP criada. Aguarde a confirmação.' });
    }

    const body = {
      transaction_amount: price,
      description: plan === 'life' ? 'Curso da Passada — Acesso Vitalício' : 'Curso da Passada — VIP (30 dias)',
      payment_method_id: method === 'pix_bank_transfer' ? 'pix' : method,
      payer,
      external_reference: ref,
      metadata: { curso: 'curso_da_passada', plan, user_id: uid }
    };
    if (method === 'pix' || method === 'pix_bank_transfer') {
      body.payment_method_id = 'pix';
      body.payment_type_id = 'bank_transfer';
    } else {
      if (!payment.token) return res.status(400).json({ message: 'Não foi possível tokenizar o cartão. Tente novamente.' });
      body.token = payment.token;
      body.installments = Number(payment.installments) || 1;
      if (payment.issuer_id) body.issuer_id = String(payment.issuer_id);
    }

    // A mesma referência recebe a mesma chave de idempotência durante a sessão.
    const idempotency = crypto.createHash('sha256').update(ref).digest('hex');
    const result = await mp('/v1/payments', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': idempotency },
      body: JSON.stringify(body)
    });

    await savePaymentUser(uid, { pendingPlan: plan, pendingReference: ref, lastPaymentId: String(result.id), lastPaymentStatus: result.status || 'pending' });
    if (result.status === 'approved') await processPayment(String(result.id));

    const tx = result.point_of_interaction?.transaction_data || {};
    return res.json({
      ok: true,
      type: method === 'pix' || method === 'pix_bank_transfer' ? 'pix' : 'card',
      id: String(result.id), status: result.status, status_detail: result.status_detail,
      qr_code: tx.qr_code || null, qr_code_base64: tx.qr_code_base64 || null,
      ticket_url: tx.ticket_url || null,
      message: result.status === 'approved' ? 'Pagamento aprovado!' : 'Pagamento criado. Aguarde a confirmação.',
      detail: result.status_detail || null
    });
  } catch (e) {
    console.error('Process payment:', e.data || e);
    res.status(e.status || 500).json({ message: e.message || 'Erro ao processar pagamento.', details: e.data || null });
  }
});

app.get('/payments/status/:id', requireAuth, async (req, res) => {
  try {
    const p = await mp('/v1/payments/' + encodeURIComponent(req.params.id));
    const parsed = parsePaymentReference(p.external_reference);
    if (!parsed || parsed.userId !== req.user.uid) return res.status(403).json({ message: 'Pagamento não pertence ao usuário autenticado.' });
    if (p.status === 'approved') await processPayment(String(p.id));
    res.json({ id: String(p.id), status: p.status, status_detail: p.status_detail, external_reference: p.external_reference || null });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message || 'Não foi possível consultar o pagamento.' });
  }
});

app.get('/subscriptions/status/:id', requireAuth, async (req, res) => {
  try {
    const s = await mp('/preapproval/' + encodeURIComponent(req.params.id));
    const parsed = parseSubscriptionReference(s.external_reference);
    if (!parsed || parsed.userId !== req.user.uid) return res.status(403).json({ message: 'Assinatura não pertence ao usuário autenticado.' });
    if (['authorized', 'cancelled', 'canceled', 'paused'].includes(String(s.status))) await processSubscription(String(s.id));
    res.json({ id: String(s.id), status: s.status, external_reference: s.external_reference || null });
  } catch (e) {
    res.status(e.status || 500).json({ message: e.message || 'Não foi possível consultar a assinatura.' });
  }
});

async function processPayment(paymentId) {
  const p = await mp('/v1/payments/' + encodeURIComponent(paymentId));
  const parsed = parsePaymentReference(p.external_reference);
  if (!parsed) return { ignored: true, reason: 'external_reference não reconhecida' };
  const { plan, userId } = parsed;
  if (p.status === 'approved') {
    const now = Date.now();
    if (plan === 'life') {
      await savePaymentUser(userId, { plan: 'life', expiresAt: null, expiresAtMs: null, freeExpiresAtMs: null, pendingPlan: null, pendingReference: null, lastPaymentId: String(p.id), lastPaymentStatus: p.status });
    } else {
      const snap = await db().ref('course/users/' + userId).once('value');
      const old = snap.val() || {};
      const oldMs = Number(old.expiresAtMs) || 0;
      const base = Math.max(now, oldMs);
      const untilMs = base + 31 * 86400000;
      await savePaymentUser(userId, { plan: 'vip', expiresAt: new Date(untilMs).toISOString(), expiresAtMs: untilMs, freeExpiresAtMs: null, pendingPlan: null, pendingReference: null, lastPaymentId: String(p.id), lastPaymentStatus: p.status });
    }
  }
  return { status: p.status, userId, plan };
}

async function processSubscription(id) {
  const s = await mp('/preapproval/' + encodeURIComponent(id));
  const parsed = parseSubscriptionReference(s.external_reference);
  if (!parsed) return { ignored: true };
  const userId = parsed.userId;
  const snap = await db().ref('course/users/' + userId).once('value');
  const old = snap.val() || {};
  const status = String(s.status || '');

  if (status === 'authorized') {
    // Não prorroga novamente em cada webhook repetido. A renovação mensal deve ser
    // provocada por um pagamento aprovado; aqui apenas garante a primeira autorização.
    if (old.subscriptionId !== String(id) || old.lastSubscriptionStatus !== 'authorized') {
      const now = Date.now();
      const oldMs = Number(old.expiresAtMs) || 0;
      const untilMs = Math.max(now, oldMs) + 31 * 86400000;
      await savePaymentUser(userId, { plan: 'vip', expiresAt: new Date(untilMs).toISOString(), expiresAtMs: untilMs, freeExpiresAtMs: null, subscriptionId: String(id), lastSubscriptionStatus: 'authorized' });
    }
  } else if (['cancelled', 'canceled', 'paused'].includes(status)) {
    await savePaymentUser(userId, { plan: 'free', expiresAt: null, expiresAtMs: 0, subscriptionId: String(id), lastSubscriptionStatus: status });
  }
  return { status, userId };
}

app.get('/payments/connection-test', requireAuth, async (req, res) => {
  try {
    if (!isAdmin(req.user)) return res.status(403).json({ message: 'Somente o administrador pode executar este diagnóstico.' });
    if (!MP_TOKEN) return res.status(503).json({ ok: false, message: 'MERCADO_PAGO_ACCESS_TOKEN não configurado.' });
    const r = await mp('/v1/payments/search?limit=1');
    res.json({ ok: true, mercadoPago: true, total: r.paging?.total ?? null });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, mercadoPago: false, message: e.message, details: e.data || null });
  }
});

app.get('/payments/diagnostic', requireAuth, async (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ message: 'Somente o administrador.' });
  res.json({ online: true, mercadoPagoConfigured: !!MP_TOKEN, mercadoPagoPublicKeyConfigured: !!MP_PUBLIC_KEY, firebaseConfigured: !!db(), message: 'Payment Brick/tokenização devem ser usados no frontend; nenhum dado bruto de cartão é armazenado aqui.' });
});

app.post('/webhooks/mercadopago', async (req, res) => {
  // Responde rápido ao Mercado Pago; processamento é idempotente.
  res.sendStatus(200);
  try {
    if (!verifyWebhook(req)) return console.warn('Webhook Mercado Pago com assinatura inválida');
    const type = req.body?.type || req.body?.topic;
    const id = req.body?.data?.id || req.body?.id;
    if (!id) return;
    if (type === 'payment' || type === 'merchant_order' || type === 'payment.updated') await processPayment(id);
    else if (String(type).includes('subscription') || String(type).includes('preapproval')) await processSubscription(id);
  } catch (e) { console.error('Webhook:', e.message); }
});

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(path.join(publicDir, 'index.html'))) {
  app.use(express.static(publicDir));
  app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
} else {
  app.get('/', (req, res) => res.json({ online: true, service: 'Curso da Passada Payments', api: true, version: '12.0.0-secure' }));
}

app.listen(PORT, () => console.log(`Curso da Passada rodando na porta ${PORT}`));
