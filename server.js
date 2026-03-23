require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const mongoose = require('mongoose');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── CONNEXION MONGODB ──
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log('MongoDB connecte');
}).catch(e => console.log('MongoDB erreur:', e.message));

// ── SCHEMA MESSAGE ──
const MsgSchema = new mongoose.Schema({
  platform:  String,
  entity:    String,
  from:      String,
  fromName:  String,
  text:      String,
  timestamp: { type: Date, default: Date.now },
  unread:    { type: Boolean, default: true },
  sent:      { type: Boolean, default: false },
  threadId:  String,
  msgs:      [{ s: Boolean, t: String, ts: String }]
});
const Msg = mongoose.model('Message', MsgSchema);

function getEntity(pageId) {
  const map = {
    [process.env.PAGE_ID_MINIAGRI]:  'miniagri',
    [process.env.PAGE_ID_MINITP]:    'minitp',
    [process.env.PAGE_ID_MINITRUCK]: 'minitruck',
  };
  return map[pageId] || null;
}

function getToken(entity) {
  const map = {
    miniagri:  process.env.PAGE_TOKEN_MINIAGRI,
    minitp:    process.env.PAGE_TOKEN_MINITP,
    minitruck: process.env.PAGE_TOKEN_MINITRUCK,
  };
  return map[entity] || process.env.PAGE_TOKEN_MINIAGRI;
}

async function getRealName(userId, token, platform) {
  if (!token || !userId) return userId;
  try {
    const fields = platform === 'instagram' ? 'name,username' : 'name,first_name';
    const r = await axios.get('https://graph.facebook.com/v18.0/' + userId, {
      params: { fields, access_token: token }
    });
    return r.data.username || r.data.name || userId;
  } catch(e) { return userId; }
}

// ── SERVIR LE SITE ──
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) res.sendFile(htmlPath);
  else res.json({ status: 'ok', app: 'MiniHub v4' });
});

// ── WEBHOOK META ──
app.get('/webhook/meta', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.META_VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook/meta', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (!body.entry) return;

  for (const entry of body.entry) {
    const pageId = entry.id;
    const entity = getEntity(pageId);
    const token  = entity ? getToken(entity) : process.env.PAGE_TOKEN_MINIAGRI;

    // FACEBOOK
    if (entry.messaging) {
      for (const event of entry.messaging) {
        if (!event.message || event.message.is_echo) continue;
        const senderId = event.sender.id;
        const recipientId = event.recipient && event.recipient.id;
        const detectedEntity = getEntity(recipientId) || getEntity(pageId) || 'miniagri';
        const realName = await getRealName(senderId, token, 'facebook');
        const txt = event.message.text || '[media]';
        const ts = new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});

        const existing = await Msg.findOne({ threadId: senderId, platform: 'facebook' });
        if (existing) {
          existing.msgs.push({ s: false, t: txt, ts });
          existing.unread = true;
          existing.fromName = realName;
          existing.text = txt;
          await existing.save();
        } else {
          await Msg.create({ platform:'facebook', entity:detectedEntity, from:senderId, fromName:realName, text:txt, unread:true, sent:false, threadId:senderId, msgs:[{s:false,t:txt,ts}] });
        }
        console.log('Facebook [' + detectedEntity + '] de ' + realName + ': ' + txt);
      }
    }

    // INSTAGRAM
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const val = change.value;
        if (!val || !val.message || val.message.is_echo) continue;
        const senderId = val.sender && val.sender.id;
        const recipientId = val.recipient && val.recipient.id;
        const detectedEntity = getEntity(recipientId) || getEntity(pageId) || 'miniagri';
        const igToken = getToken(detectedEntity);
        const realName = await getRealName(senderId, igToken, 'instagram');
        const txt = (val.message && val.message.text) || '[media]';
        const ts = new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});

        const existing = await Msg.findOne({ threadId: senderId, platform: 'instagram' });
        if (existing) {
          existing.msgs.push({ s: false, t: txt, ts });
          existing.unread = true;
          existing.fromName = realName;
          existing.text = txt;
          await existing.save();
        } else {
          await Msg.create({ platform:'instagram', entity:detectedEntity, from:senderId, fromName:realName, text:txt, unread:true, sent:false, threadId:senderId, msgs:[{s:false,t:txt,ts}] });
        }
        console.log('Instagram [' + detectedEntity + '] de ' + realName + ': ' + txt);
      }
    }
  }
});

// ── WEBHOOK WHATSAPP ──
app.get('/webhook/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WA_VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (body.object !== 'whatsapp_business_account') return;
  for (const entry of (body.entry || [])) {
    for (const change of (entry.changes || [])) {
      const val = change.value;
      for (const waMsg of (val.messages || [])) {
        if (waMsg.type !== 'text') continue;
        const contact = (val.contacts || []).find(c => c.wa_id === waMsg.from);
        const name = (contact && contact.profile && contact.profile.name) || waMsg.from;
        const txt = waMsg.text.body;
        const ts = new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});

        const existing = await Msg.findOne({ threadId: waMsg.from, platform: 'whatsapp' });
        if (existing) {
          existing.msgs.push({ s: false, t: txt, ts });
          existing.unread = true;
          existing.text = txt;
          await existing.save();
        } else {
          await Msg.create({ platform:'whatsapp', entity:'whatsapp', from:waMsg.from, fromName:name, text:txt, unread:true, sent:false, threadId:waMsg.from, msgs:[{s:false,t:txt,ts}] });
        }
        console.log('WhatsApp de ' + name + ': ' + txt);
      }
    }
  }
});

// ── API MESSAGES ──
app.get('/api/messages', async (req, res) => {
  try {
    let query = {};
    if (req.query.entity && req.query.entity !== 'all') {
      if (req.query.entity === 'whatsapp') query.platform = 'whatsapp';
      else query.entity = req.query.entity;
    }
    if (req.query.platform && req.query.platform !== 'all') query.platform = req.query.platform;
    const msgs = await Msg.find(query).sort({ timestamp: -1 }).limit(200);
    res.json({ success: true, count: msgs.length, messages: msgs });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── API THREAD ──
app.get('/api/thread/:threadId', async (req, res) => {
  try {
    const msg = await Msg.findOne({ threadId: req.params.threadId });
    res.json({ success: true, message: msg });
  } catch(e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── API ENVOYER ──
app.post('/api/send', async (req, res) => {
  const { platform, entity, recipientId, text, threadId } = req.body;
  if (!platform || !text || !recipientId) return res.status(400).json({ success: false, error: 'Params manquants' });
  try {
    const token = getToken(entity);
    if (platform === 'facebook' || platform === 'instagram') {
      await axios.post('https://graph.facebook.com/v18.0/me/messages',
        { recipient: { id: recipientId }, message: { text } },
        { params: { access_token: token } }
      );
    } else if (platform === 'whatsapp') {
      await axios.post('https://graph.facebook.com/v18.0/' + process.env.WA_PHONE_NUMBER_ID + '/messages',
        { messaging_product: 'whatsapp', to: recipientId, type: 'text', text: { body: text } },
        { headers: { Authorization: 'Bearer ' + process.env.WA_ACCESS_TOKEN } }
      );
    }
    const ts = new Date().toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit'});
    const existing = await Msg.findOne({ threadId: threadId || recipientId });
    if (existing) {
      existing.msgs.push({ s: true, t: text, ts });
      await existing.save();
    }
    res.json({ success: true });
  } catch(err) {
    res.status(500).json({ success: false, error: (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message });
  }
});

// ── API MARQUER LU ──
app.patch('/api/messages/:id/read', async (req, res) => {
  try {
    await Msg.findByIdAndUpdate(req.params.id, { unread: false });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ success: false }); }
});

// ── API IA ──
app.post('/api/ai/suggest', async (req, res) => {
  const { entity, messages: history, context } = req.body;
  const names = { miniagri: 'MiniAgri', minitp: 'MiniTP', minitruck: 'MiniTruck' };
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-20250514', max_tokens: 300, system: 'Tu es assistant commercial de ' + (names[entity] || entity) + '. ' + (context || '') + ' Reponds en francais, professionnellement. Max 3-4 phrases.', messages: history },
      { headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } }
    );
    res.json({ success: true, text: r.data.content[0].text });
  } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── API STATS ──
app.get('/api/stats', async (req, res) => {
  try {
    const total   = await Msg.countDocuments();
    const unread  = await Msg.countDocuments({ unread: true });
    res.json({ success: true, total, unread });
  } catch(e) { res.status(500).json({ success: false }); }
});

app.listen(PORT, () => console.log('MiniHub v4 avec MongoDB sur port ' + PORT));
