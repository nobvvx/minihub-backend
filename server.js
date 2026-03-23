require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const messages = [];
let msgId = 1;

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
    if (platform === 'instagram') {
      const r = await axios.get('https://graph.facebook.com/v18.0/'+userId, {
        params: { fields: 'name,username', access_token: token }
      });
      return r.data.username || r.data.name || userId;
    } else {
      const r = await axios.get('https://graph.facebook.com/v18.0/'+userId, {
        params: { fields: 'name,first_name', access_token: token }
      });
      return r.data.name || userId;
    }
  } catch(e) { return userId; }
}

app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) res.sendFile(htmlPath);
  else res.json({ status: 'ok', app: 'MiniHub Backend v3' });
});

app.get('/webhook/meta', (req, res) => {
  if (req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.META_VERIFY_TOKEN) {
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

    if (entry.messaging) {
      for (const event of entry.messaging) {
        if (!event.message || event.message.is_echo) continue;
        const senderId = event.sender.id;
        const recipientId = event.recipient && event.recipient.id;
        const detectedEntity = getEntity(recipientId) || getEntity(pageId) || 'miniagri';
        const realName = await getRealName(senderId, token, 'facebook');
        const txt = event.message.text || '[media]';
        const ts = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});

        const existing = messages.find(m => m.threadId===senderId && m.platform==='facebook');
        if (existing) {
          existing.msgs.push({s:false,t:txt,ts});
          existing.unread=true;existing.fromName=realName;existing.text=txt;
        } else {
          messages.unshift({id:msgId++,platform:'facebook',entity:detectedEntity,from:senderId,fromName:realName,text:txt,timestamp:new Date().toISOString(),unread:true,sent:false,threadId:senderId,msgs:[{s:false,t:txt,ts}]});
        }
        console.log('Facebook ['+detectedEntity+'] de '+realName+': '+txt);
      }
    }

    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field!=='messages') continue;
        const val = change.value;
        if (!val||!val.message||val.message.is_echo) continue;
        const senderId = val.sender && val.sender.id;
        const recipientId = val.recipient && val.recipient.id;
        const detectedEntity = getEntity(recipientId) || getEntity(pageId) || 'miniagri';
        const igToken = getToken(detectedEntity);
        const realName = await getRealName(senderId, igToken, 'instagram');
        const txt = (val.message && val.message.text) || '[media]';
        const ts = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});

        const existing = messages.find(m => m.threadId===senderId && m.platform==='instagram');
        if (existing) {
          existing.msgs.push({s:false,t:txt,ts});
          existing.unread=true;existing.fromName=realName;existing.text=txt;
        } else {
          messages.unshift({id:msgId++,platform:'instagram',entity:detectedEntity,from:senderId,fromName:realName,text:txt,timestamp:new Date().toISOString(),unread:true,sent:false,threadId:senderId,msgs:[{s:false,t:txt,ts}]});
        }
        console.log('Instagram ['+detectedEntity+'] de '+realName+': '+txt);
      }
    }
  }
});

app.get('/webhook/whatsapp', (req, res) => {
  if (req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.WA_VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else res.sendStatus(403);
});

app.post('/webhook/whatsapp', (req, res) => {
  res.sendStatus(200);
  const body = req.body;
  if (body.object!=='whatsapp_business_account') return;
  body.entry && body.entry.forEach(function(entry) {
    entry.changes && entry.changes.forEach(function(change) {
      const val = change.value;
      val.messages && val.messages.forEach(function(waMsg) {
        if (waMsg.type!=='text') return;
        const contact = val.contacts && val.contacts.find(function(c){return c.wa_id===waMsg.from;});
        const name = (contact && contact.profile && contact.profile.name) || waMsg.from;
        const txt = waMsg.text.body;
        const ts = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
        const existing = messages.find(function(m){return m.threadId===waMsg.from && m.platform==='whatsapp';});
        if (existing) {
          existing.msgs.push({s:false,t:txt,ts});existing.unread=true;existing.text=txt;
        } else {
          messages.unshift({id:msgId++,platform:'whatsapp',entity:'whatsapp',from:waMsg.from,fromName:name,text:txt,timestamp:new Date(parseInt(waMsg.timestamp)*1000).toISOString(),unread:true,sent:false,threadId:waMsg.from,msgs:[{s:false,t:txt,ts}]});
        }
        console.log('WhatsApp de '+name+': '+txt);
      });
    });
  });
});

app.get('/api/messages', (req, res) => {
  let result = messages.slice();
  if (req.query.entity && req.query.entity!=='all') {
    if (req.query.entity==='whatsapp') result=result.filter(function(m){return m.platform==='whatsapp';});
    else result=result.filter(function(m){return m.entity===req.query.entity;});
  }
  if (req.query.platform && req.query.platform!=='all') result=result.filter(function(m){return m.platform===req.query.platform;});
  res.json({success:true,count:result.length,messages:result});
});

app.get('/api/thread/:threadId', (req, res) => {
  const msg = messages.find(function(m){return m.threadId===req.params.threadId;});
  res.json({success:true,message:msg||null});
});

app.post('/api/send', async (req, res) => {
  const {platform,entity,recipientId,text,threadId} = req.body;
  if (!platform||!text||!recipientId) return res.status(400).json({success:false,error:'Params manquants'});
  try {
    const token = getToken(entity);
    if (platform==='facebook'||platform==='instagram') {
      await axios.post('https://graph.facebook.com/v18.0/me/messages',{recipient:{id:recipientId},message:{text}},{params:{access_token:token}});
    } else if (platform==='whatsapp') {
      await axios.post('https://graph.facebook.com/v18.0/'+process.env.WA_PHONE_NUMBER_ID+'/messages',{messaging_product:'whatsapp',to:recipientId,type:'text',text:{body:text}},{headers:{Authorization:'Bearer '+process.env.WA_ACCESS_TOKEN}});
    }
    const ts = new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    const existing = messages.find(function(m){return m.threadId===threadId;});
    if (existing) existing.msgs.push({s:true,t:text,ts});
    else messages.unshift({id:msgId++,platform,entity:entity||'whatsapp',from:'me',fromName:'Vous',text,timestamp:new Date().toISOString(),unread:false,sent:true,threadId:threadId||recipientId,msgs:[{s:true,t:text,ts}]});
    res.json({success:true});
  } catch(err) {
    res.status(500).json({success:false,error:(err.response&&err.response.data&&err.response.data.error&&err.response.data.error.message)||err.message});
  }
});

app.patch('/api/messages/:id/read', (req, res) => {
  const msg = messages.find(function(m){return m.id===parseInt(req.params.id);});
  if (msg) {msg.unread=false;res.json({success:true});}
  else res.status(404).json({success:false});
});

app.post('/api/ai/suggest', async (req, res) => {
  const {entity,messages:history,context} = req.body;
  const names = {miniagri:'MiniAgri',minitp:'MiniTP',minitruck:'MiniTruck'};
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      {model:'claude-sonnet-4-20250514',max_tokens:300,system:'Tu es assistant commercial de '+(names[entity]||entity)+'. '+(context||'')+' Reponds en francais, professionnellement. Max 3-4 phrases.',messages:history},
      {headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'}}
    );
    res.json({success:true,text:r.data.content[0].text});
  } catch(err) {res.status(500).json({success:false,error:err.message});}
});

app.get('/api/stats', (req, res) => {
  res.json({success:true,total:messages.length,unread:messages.filter(function(m){return m.unread;}).length,byEntity:{miniagri:messages.filter(function(m){return m.entity==='miniagri';}).length,minitp:messages.filter(function(m){return m.entity==='minitp';}).length,minitruck:messages.filter(function(m){return m.entity==='minitruck';}).length,whatsapp:messages.filter(function(m){return m.platform==='whatsapp';}).length}});
});

app.listen(PORT, function() {
  console.log('MiniHub Backend v3 sur port '+PORT);
});
