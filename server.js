// ════════════════════════════════════════════════════════
// MINIHUB BACKEND — Serveur principal
// MiniAgri · MiniTP · MiniTruck
// Instagram + Facebook + Messenger + WhatsApp
// ════════════════════════════════════════════════════════

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Stockage en mémoire des messages (remplacez par une DB plus tard) ──
const messages = [];
let messageId  = 1;

// ── Map Page ID → Entité ──
function getEntityByPageId(pageId) {
  const map = {
    [process.env.PAGE_ID_MINIAGRI]:  'miniagri',
    [process.env.PAGE_ID_MINITP]:    'minitp',
    [process.env.PAGE_ID_MINITRUCK]: 'minitruck',
  };
  return map[pageId] || 'miniagri';
}

// ── Map Page ID → Token ──
function getTokenByPageId(pageId) {
  const map = {
    [process.env.PAGE_ID_MINIAGRI]:  process.env.PAGE_TOKEN_MINIAGRI,
    [process.env.PAGE_ID_MINITP]:    process.env.PAGE_TOKEN_MINITP,
    [process.env.PAGE_ID_MINITRUCK]: process.env.PAGE_TOKEN_MINITRUCK,
  };
  return map[pageId] || process.env.PAGE_TOKEN_MINIAGRI;
}

function getTokenByEntity(entity) {
  const map = {
    miniagri:  process.env.PAGE_TOKEN_MINIAGRI,
    minitp:    process.env.PAGE_TOKEN_MINITP,
    minitruck: process.env.PAGE_TOKEN_MINITRUCK,
  };
  return map[entity];
}

// ════════════════════════════════════════════
// ROUTE TEST
// ════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    app: 'MiniHub Backend',
    version: '1.0.0',
    entities: ['miniagri', 'minitp', 'minitruck'],
    platforms: ['instagram', 'facebook', 'messenger', 'whatsapp'],
    message: 'Serveur opérationnel ✓'
  });
});

// ════════════════════════════════════════════
// WEBHOOK META — VÉRIFICATION
// Instagram + Facebook + Messenger
// ════════════════════════════════════════════
app.get('/webhook/meta', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('✓ Webhook Meta vérifié');
    res.status(200).send(challenge);
  } else {
    console.error('✗ Vérification webhook Meta échouée');
    res.sendStatus(403);
  }
});

// ════════════════════════════════════════════
// WEBHOOK META — RÉCEPTION MESSAGES
// ════════════════════════════════════════════
app.post('/webhook/meta', (req, res) => {
  const body = req.body;
  res.sendStatus(200); // Répondre immédiatement à Meta

  if (body.object !== 'page' && body.object !== 'instagram') return;

  body.entry?.forEach(entry => {
    const pageId = entry.id;
    const entity = getEntityByPageId(pageId);

    // ── MESSENGER & FACEBOOK ──
    entry.messaging?.forEach(event => {
      if (!event.message || event.message.is_echo) return;

      const msg = {
        id:        messageId++,
        platform:  'facebook',
        entity,
        from:      event.sender.id,
        fromName:  event.sender.name || event.sender.id,
        text:      event.message.text || '[média]',
        timestamp: new Date().toISOString(),
        unread:    true,
        sent:      false,
        threadId:  event.sender.id,
      };
      messages.push(msg);
      console.log(`📨 Facebook [${entity}] de ${msg.fromName}: ${msg.text}`);
    });

    // ── INSTAGRAM DMs ──
    entry.changes?.forEach(change => {
      if (change.field !== 'messages') return;
      const val = change.value;
      if (!val.message || val.message.is_echo) return;

      const msg = {
        id:        messageId++,
        platform:  'instagram',
        entity,
        from:      val.sender.id,
        fromName:  val.sender.username || val.sender.id,
        text:      val.message.text || '[média]',
        timestamp: new Date().toISOString(),
        unread:    true,
        sent:      false,
        threadId:  val.sender.id,
      };
      messages.push(msg);
      console.log(`📨 Instagram [${entity}] de ${msg.fromName}: ${msg.text}`);
    });
  });
});

// ════════════════════════════════════════════
// WEBHOOK WHATSAPP — VÉRIFICATION
// ════════════════════════════════════════════
app.get('/webhook/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('✓ Webhook WhatsApp vérifié');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ════════════════════════════════════════════
// WEBHOOK WHATSAPP — RÉCEPTION MESSAGES
// ════════════════════════════════════════════
app.post('/webhook/whatsapp', (req, res) => {
  const body = req.body;
  res.sendStatus(200);

  if (body.object !== 'whatsapp_business_account') return;

  body.entry?.forEach(entry => {
    entry.changes?.forEach(change => {
      const val = change.value;
      val.messages?.forEach(waMsg => {
        if (waMsg.type !== 'text') return;

        // Trouver le nom du contact
        const contact = val.contacts?.find(c => c.wa_id === waMsg.from);
        const name    = contact?.profile?.name || waMsg.from;

        // Détecter l'entité depuis le texte ou numéro (sinon whatsapp général)
        const msg = {
          id:        messageId++,
          platform:  'whatsapp',
          entity:    'whatsapp', // Section WhatsApp unifiée
          from:      waMsg.from,
          fromName:  name,
          text:      waMsg.text.body,
          timestamp: new Date(parseInt(waMsg.timestamp) * 1000).toISOString(),
          unread:    true,
          sent:      false,
          threadId:  waMsg.from,
          waId:      waMsg.id,
        };
        messages.push(msg);
        console.log(`📨 WhatsApp de ${name} (${waMsg.from}): ${waMsg.text.body}`);
      });
    });
  });
});

// ════════════════════════════════════════════
// API — RÉCUPÉRER LES MESSAGES
// ════════════════════════════════════════════
app.get('/api/messages', (req, res) => {
  const { entity, platform, unread } = req.query;
  let result = [...messages];

  if (entity && entity !== 'all')     result = result.filter(m => m.entity === entity);
  if (platform && platform !== 'all') result = result.filter(m => m.platform === platform);
  if (unread === 'true')              result = result.filter(m => m.unread);

  // Trier par date décroissante
  result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.json({ success: true, count: result.length, messages: result });
});

// ════════════════════════════════════════════
// API — RÉCUPÉRER UN THREAD COMPLET
// ════════════════════════════════════════════
app.get('/api/thread/:threadId', (req, res) => {
  const thread = messages
    .filter(m => m.threadId === req.params.threadId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  res.json({ success: true, messages: thread });
});

// ════════════════════════════════════════════
// API — ENVOYER UN MESSAGE
// ════════════════════════════════════════════
app.post('/api/send', async (req, res) => {
  const { platform, entity, recipientId, text, threadId } = req.body;

  if (!platform || !text || !recipientId) {
    return res.status(400).json({ success: false, error: 'Paramètres manquants' });
  }

  try {
    let response;

    // ── ENVOYER VIA FACEBOOK / MESSENGER ──
    if (platform === 'facebook' || platform === 'messenger') {
      const token = getTokenByEntity(entity);
      response = await axios.post(
        `https://graph.facebook.com/v18.0/me/messages`,
        {
          recipient: { id: recipientId },
          message:   { text },
        },
        { params: { access_token: token } }
      );
    }

    // ── ENVOYER VIA INSTAGRAM ──
    else if (platform === 'instagram') {
      const token = getTokenByEntity(entity);
      response = await axios.post(
        `https://graph.facebook.com/v18.0/me/messages`,
        {
          recipient: { id: recipientId },
          message:   { text },
        },
        { params: { access_token: token } }
      );
    }

    // ── ENVOYER VIA WHATSAPP ──
    else if (platform === 'whatsapp') {
      response = await axios.post(
        `https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type:    'individual',
          to:                recipientId,
          type:              'text',
          text:              { body: text },
        },
        {
          headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}` },
        }
      );
    }

    // Sauvegarder le message envoyé
    const sent = {
      id:        messageId++,
      platform,
      entity:    entity || 'whatsapp',
      from:      'me',
      fromName:  'Vous',
      text,
      timestamp: new Date().toISOString(),
      unread:    false,
      sent:      true,
      threadId:  threadId || recipientId,
    };
    messages.push(sent);

    console.log(`✉️ Message envoyé [${platform}/${entity}] à ${recipientId}: ${text}`);
    res.json({ success: true, message: sent, apiResponse: response?.data });

  } catch (err) {
    console.error('Erreur envoi:', err.response?.data || err.message);
    res.status(500).json({
      success: false,
      error: err.response?.data?.error?.message || err.message
    });
  }
});

// ════════════════════════════════════════════
// API — MARQUER COMME LU
// ════════════════════════════════════════════
app.patch('/api/messages/:id/read', (req, res) => {
  const msg = messages.find(m => m.id === parseInt(req.params.id));
  if (msg) { msg.unread = false; res.json({ success: true }); }
  else res.status(404).json({ success: false });
});

// ════════════════════════════════════════════
// API — SUGGESTION IA
// ════════════════════════════════════════════
app.post('/api/ai/suggest', async (req, res) => {
  const { entity, messages: history, context } = req.body;

  const entityNames = {
    miniagri:  'MiniAgri',
    minitp:    'MiniTP',
    minitruck: 'MiniTruck',
  };

  const sys = `Tu es l'assistant commercial de ${entityNames[entity] || entity}. ${context || ''}
Réponds de façon professionnelle et chaleureuse en français. Maximum 3-4 phrases.`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 300,
        system:     sys,
        messages:   history,
      },
      {
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
      }
    );
    res.json({ success: true, text: response.data.content[0].text });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════
// API — STATS
// ════════════════════════════════════════════
app.get('/api/stats', (req, res) => {
  res.json({
    success: true,
    total:    messages.length,
    unread:   messages.filter(m => m.unread).length,
    pending:  messages.filter(m => !m.sent).length,
    byEntity: {
      miniagri:  messages.filter(m => m.entity === 'miniagri').length,
      minitp:    messages.filter(m => m.entity === 'minitp').length,
      minitruck: messages.filter(m => m.entity === 'minitruck').length,
      whatsapp:  messages.filter(m => m.platform === 'whatsapp').length,
    },
    byPlatform: {
      instagram: messages.filter(m => m.platform === 'instagram').length,
      facebook:  messages.filter(m => m.platform === 'facebook').length,
      whatsapp:  messages.filter(m => m.platform === 'whatsapp').length,
    }
  });
});

// ════════════════════════════════════════════
// DÉMARRAGE
// ════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   MiniHub Backend — Démarré ✓         ║
  ║   Port: ${PORT}                           ║
  ║   Webhooks:                           ║
  ║   → /webhook/meta                     ║
  ║   → /webhook/whatsapp                 ║
  ║   API:                                ║
  ║   → GET  /api/messages                ║
  ║   → POST /api/send                    ║
  ║   → POST /api/ai/suggest              ║
  ║   → GET  /api/stats                   ║
  ╚═══════════════════════════════════════╝
  `);
});
