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
  return map[pageId] || 'miniagri';
}

function getToken(entity) {
  const map = {
    miniagri:  process.env.PAGE_TOKEN_MINIAGRI,
    minitp:    process.env.PAGE_TOKEN_MINITP,
    minitruck: process.env.PAGE_TOKEN_MINITRUCK,
  };
  return map[entity] || process.env.PAGE_TOKEN_MINIAGRI;
}

// SERVIR LE SITE HTML
app.get('/', (req, res) => {
  const htmlPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.json({ status: 'ok', app: 'MiniHub Backend', message: 'Ajoutez index.html dans le repo' });
  }
});

// WEBHOOK META
app.get('/webhook/meta', (req, res) => {
  const mode=req.query['hub.mode'], token=req.query['hub.verify_token'], challenge=req.query['hub.challenge'];
  if(mode==='subscribe'&&token===process.env.META_VERIFY_TOKEN){res.status(200).send(challenge);}
  else{res.sendStatus(403);}
});

app.post('/webhook/meta', (req, res) => {
  const body=req.body;
  res.sendStatus(200);
  if(!body.entry)return;
  body.entry.forEach(entry=>{
    const pageId=entry.id, entity=getEntity(pageId);
    if(entry.messaging){
      entry.messaging.forEach(event=>{
        if(!event.message||event.message.is_echo)return;
        messages.unshift({id:msgId++,platform:'facebook',entity,from:event.sender.id,fromName:event.sender.name||event.sender.id,text:event.message.text||'[media]',timestamp:new Date().toISOString(),unread:true,sent:false,threadId:event.sender.id});
        console.log(`Facebook [${entity}] de ${event.sender.id}: ${event.message.text}`);
      });
    }
    if(entry.changes){
      entry.changes.forEach(change=>{
        if(change.field!=='messages')return;
        const val=change.value;
        if(!val||!val.message||val.message.is_echo)return;
        const igPageId=val.recipient?.id||pageId;
        const igEntity=getEntity(igPageId);
        messages.unshift({id:msgId++,platform:'instagram',entity:igEntity,from:val.sender?.id||'unknown',fromName:val.sender?.username||val.sender?.id||'Client Instagram',text:val.message?.text||'[media]',timestamp:new Date().toISOString(),unread:true,sent:false,threadId:val.sender?.id||'unknown'});
        console.log(`Instagram [${igEntity}] de ${val.sender?.username}: ${val.message?.text}`);
      });
    }
  });
});

// WEBHOOK WHATSAPP
app.get('/webhook/whatsapp', (req, res) => {
  const mode=req.query['hub.mode'], token=req.query['hub.verify_token'], challenge=req.query['hub.challenge'];
  if(mode==='subscribe'&&token===process.env.WA_VERIFY_TOKEN){res.status(200).send(challenge);}
  else{res.sendStatus(403);}
});

app.post('/webhook/whatsapp', (req, res) => {
  const body=req.body;
  res.sendStatus(200);
  if(body.object!=='whatsapp_business_account')return;
  body.entry?.forEach(entry=>{
    entry.changes?.forEach(change=>{
      const val=change.value;
      val.messages?.forEach(waMsg=>{
        if(waMsg.type!=='text')return;
        const contact=val.contacts?.find(c=>c.wa_id===waMsg.from);
        const name=contact?.profile?.name||waMsg.from;
        messages.unshift({id:msgId++,platform:'whatsapp',entity:'whatsapp',from:waMsg.from,fromName:name,text:waMsg.text.body,timestamp:new Date(parseInt(waMsg.timestamp)*1000).toISOString(),unread:true,sent:false,threadId:waMsg.from});
        console.log(`WhatsApp de ${name}: ${waMsg.text.body}`);
      });
    });
  });
});

// API
app.get('/api/messages', (req, res) => {
  let result=[...messages];
  if(req.query.entity&&req.query.entity!=='all')result=result.filter(m=>m.entity===req.query.entity);
  if(req.query.platform&&req.query.platform!=='all')result=result.filter(m=>m.platform===req.query.platform);
  res.json({success:true,count:result.length,messages:result});
});

app.post('/api/send', async (req, res) => {
  const{platform,entity,recipientId,text}=req.body;
  if(!platform||!text||!recipientId)return res.status(400).json({success:false,error:'Params manquants'});
  try{
    const token=getToken(entity);
    if(platform==='facebook'||platform==='instagram'){
      await axios.post('https://graph.facebook.com/v18.0/me/messages',{recipient:{id:recipientId},message:{text}},{params:{access_token:token}});
    } else if(platform==='whatsapp'){
      await axios.post(`https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,{messaging_product:'whatsapp',to:recipientId,type:'text',text:{body:text}},{headers:{Authorization:`Bearer ${process.env.WA_ACCESS_TOKEN}`}});
    }
    messages.unshift({id:msgId++,platform,entity:entity||'whatsapp',from:'me',fromName:'Vous',text,timestamp:new Date().toISOString(),unread:false,sent:true,threadId:recipientId});
    res.json({success:true});
  }catch(err){
    res.status(500).json({success:false,error:err.response?.data?.error?.message||err.message});
  }
});

app.post('/api/ai/suggest', async (req, res) => {
  const{entity,messages:history,context}=req.body;
  const names={miniagri:'MiniAgri',minitp:'MiniTP',minitruck:'MiniTruck'};
  try{
    const r=await axios.post('https://api.anthropic.com/v1/messages',
      {model:'claude-sonnet-4-20250514',max_tokens:300,system:`Tu es assistant de ${names[entity]||entity}. ${context||''} Reponds en francais, max 3-4 phrases.`,messages:history},
      {headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'}}
    );
    res.json({success:true,text:r.data.content[0].text});
  }catch(err){res.status(500).json({success:false,error:err.message});}
});

app.get('/api/stats', (req, res) => {
  res.json({success:true,total:messages.length,unread:messages.filter(m=>m.unread).length});
});

app.listen(PORT, ()=>console.log(`MiniHub sur port ${PORT}`));
