const express=require('express');
const path=require('path');
const crypto=require('crypto');
const admin=require('firebase-admin');
const app=express();app.use(express.json({limit:'1mb'}));
const PORT=process.env.PORT||10000;
const FRONTEND_URL=(process.env.FRONTEND_URL||'').replace(/\/$/,'');
const MP_TOKEN=process.env.MERCADO_PAGO_ACCESS_TOKEN||'';
const MP_WEBHOOK_SECRET=process.env.MERCADO_PAGO_WEBHOOK_SECRET||'';
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||'diel_zi_nho25@hotmail.com').toLowerCase();
if(!admin.apps.length){
 let serviceAccount;
 try{serviceAccount=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'{}')}catch(e){console.error('FIREBASE_SERVICE_ACCOUNT_JSON inválido')}
 if(serviceAccount.project_id){admin.initializeApp({credential:admin.credential.cert(serviceAccount),databaseURL:process.env.FIREBASE_DATABASE_URL||'https://balanco-roupas-eeead-default-rtdb.firebaseio.com'});}
}
const db=()=>admin.apps.length?admin.database():null;
async function mp(pathname,options={}){if(!MP_TOKEN)throw new Error('MERCADO_PAGO_ACCESS_TOKEN não configurado no Render');const r=await fetch('https://api.mercadopago.com'+pathname,{...options,headers:{'Content-Type':'application/json','Authorization':'Bearer '+MP_TOKEN,...(options.headers||{})}});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={raw:text}}if(!r.ok){const e=new Error(data.message||data.error||`Mercado Pago HTTP ${r.status}`);e.status=r.status;e.data=data;throw e}return data}
function appUrl(req){return FRONTEND_URL||`${req.protocol}://${req.get('host')}`}
function externalRef(userId,plan){return `CDP-${plan}-${userId}-${Date.now()}`}
async function getPrice(plan){const s=db();if(!s)throw new Error('Firebase Admin não configurado');const snap=await s.ref('course/settings').once('value');const v=snap.val()||{vipPrice:150,lifePrice:299.99};const price=Number(plan==='vip'?v.vipPrice:v.lifePrice);if(!Number.isFinite(price)||price<=0)throw new Error('Preço do plano inválido');return price}
async function savePaymentUser(userId,data){const d=db();if(!d)throw new Error('Firebase Admin não configurado');await d.ref('course/users/'+userId).update(data)}
app.get('/health',(req,res)=>res.json({online:true,service:'Curso da Passada Payments',version:'11.0.0',mercadoPagoConfigured:!!MP_TOKEN,firebaseConfigured:!!db(),adminEmail:ADMIN_EMAIL}));
app.post('/payments/create',async(req,res)=>{try{if(!MP_TOKEN||!db())return res.status(503).json({message:'Backend ainda não configurado no Render.'});const {plan,userId,email}=req.body||{};if(!['vip','life'].includes(plan)||!userId||!email)return res.status(400).json({message:'Dados do pagamento incompletos.'});const price=await getPrice(plan);const ref=externalRef(userId,plan);const base=appUrl(req);
 if(plan==='vip'){
   const sub=await mp('/preapproval',{method:'POST',body:JSON.stringify({reason:'Curso da Passada — Plano VIP',external_reference:ref,payer_email:String(email).toLowerCase(),auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:price,currency_id:'BRL'},back_url:base,status:'pending'})});
   await savePaymentUser(userId,{pendingPlan:'vip',pendingReference:ref,subscriptionId:sub.id});
   return res.json({checkout_url:sub.init_point,id:sub.id,type:'subscription'});
 }
 const pref=await mp('/checkout/preferences',{method:'POST',body:JSON.stringify({items:[{id:'curso-passada-life',title:'Curso da Passada — Acesso Vitalício',quantity:1,currency_id:'BRL',unit_price:price}],payer:{email:String(email).toLowerCase()},external_reference:ref,notification_url:`${base}/webhooks/mercadopago`,back_urls:{success:base,cancel:base,pending:base},auto_return:'approved'})});
 await savePaymentUser(userId,{pendingPlan:'life',pendingReference:ref});res.json({checkout_url:pref.init_point,id:pref.id,type:'preference'});
 }catch(e){console.error(e);res.status(e.status||500).json({message:e.message||'Erro ao criar pagamento.'})}});
async function processPayment(paymentId){const p=await mp('/v1/payments/'+paymentId);const ref=String(p.external_reference||'');const m=ref.match(/^CDP-(vip|life)-(.+?)-\d+$/);if(!m)return {ignored:true,reason:'external_reference não reconhecida'};const plan=m[1],userId=m[2];if(p.status==='approved'){const now=new Date();if(plan==='life'){await savePaymentUser(userId,{plan:'life',expiresAt:null,pendingPlan:null,pendingReference:null,lastPaymentId:String(p.id),lastPaymentStatus:p.status})}else{let until=new Date(now.getTime()+31*86400000);const snap=await db().ref('course/users/'+userId).once('value');const old=snap.val()||{};if(old.expiresAt&&new Date(old.expiresAt)>now)until=new Date(new Date(old.expiresAt).getTime()+31*86400000);await savePaymentUser(userId,{plan:'vip',expiresAt:until.toISOString(),pendingPlan:null,pendingReference:null,lastPaymentId:String(p.id),lastPaymentStatus:p.status})}}
 return {status:p.status,userId,plan};}
async function processSubscription(id){const s=await mp('/preapproval/'+encodeURIComponent(id));const ref=String(s.external_reference||'');const m=ref.match(/^CDP-vip-(.+?)-\d+$/);if(!m)return {ignored:true};const userId=m[1];if(s.status==='authorized'){let until=new Date(Date.now()+31*86400000);const snap=await db().ref('course/users/'+userId).once('value');const old=snap.val()||{};if(old.expiresAt&&new Date(old.expiresAt)>until)until=new Date(old.expiresAt);await savePaymentUser(userId,{plan:'vip',expiresAt:until.toISOString(),subscriptionId:String(id),lastSubscriptionStatus:s.status})}else if(['cancelled','canceled','paused'].includes(s.status)){await savePaymentUser(userId,{plan:'free',expiresAt:new Date(0).toISOString(),subscriptionId:String(id),lastSubscriptionStatus:s.status})}return {status:s.status,userId};}
function verifyWebhook(req){if(!MP_WEBHOOK_SECRET)return true;const sig=req.get('x-signature')||'';const requestId=req.get('x-request-id')||'';const dataId=String(req.body?.data?.id||'');const ts=(sig.match(/ts=([^,]+)/)||[])[1];const v1=(sig.match(/v1=([^,]+)/)||[])[1];if(!ts||!v1||!dataId)return false;const manifest=`id:${dataId};request-id:${requestId};ts:${ts};`;const h=crypto.createHmac('sha256',MP_WEBHOOK_SECRET).update(manifest).digest('hex');return crypto.timingSafeEqual(Buffer.from(h),Buffer.from(v1));}
app.post('/webhooks/mercadopago',async(req,res)=>{res.sendStatus(200);try{if(!verifyWebhook(req)){console.warn('Webhook Mercado Pago com assinatura inválida');return}const type=req.body?.type||req.body?.topic,id=req.body?.data?.id||req.body?.id;if(!id)return;if(type==='payment'||type==='merchant_order'||type==='payment.updated')await processPayment(id);else if(String(type).includes('subscription')||String(type).includes('preapproval'))await processSubscription(id);else {try{await processPayment(id)}catch{}try{await processSubscription(id)}catch{}}}catch(e){console.error('Webhook:',e.message)}});
app.use(express.static(path.join(__dirname,'public')));app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Curso da Passada rodando na porta ${PORT}`));
