const express=require('express');
const path=require('path');
const crypto=require('crypto');
const admin=require('firebase-admin');
const app=express();
app.use((req,res,next)=>{
  // API pública para o PWA: permite chamadas do domínio do site e também
  // de hospedagens estáticas/GitHub Pages. Não usamos cookies/credenciais.
  const origin=req.headers.origin;
  if(origin){
    res.setHeader('Access-Control-Allow-Origin',origin);
    res.setHeader('Vary','Origin');
  }else{
    res.setHeader('Access-Control-Allow-Origin','*');
  }
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Max-Age','86400');
  if(req.method==='OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({limit:'1mb'}));
const PORT=process.env.PORT||10000;
const FRONTEND_URL=(process.env.FRONTEND_URL||'').replace(/\/$/,'');
const MP_TOKEN=process.env.MERCADO_PAGO_ACCESS_TOKEN||'';
const MP_PUBLIC_KEY=process.env.MERCADO_PAGO_PUBLIC_KEY||'';
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
function checkoutUrl(data){return String(data?.init_point||data?.sandbox_init_point||'').trim()}
async function getPrice(plan){const s=db();if(!s)throw new Error('Firebase Admin não configurado');const snap=await s.ref('course/settings').once('value');const v=snap.val()||{vipPrice:150,lifePrice:299.99};const price=Number(plan==='vip'?v.vipPrice:v.lifePrice);if(!Number.isFinite(price)||price<=0)throw new Error('Preço do plano inválido');return price}
async function savePaymentUser(userId,data){const d=db();if(!d)throw new Error('Firebase Admin não configurado');await d.ref('course/users/'+userId).update(data)}
app.get('/health',(req,res)=>res.json({online:true,service:'Curso da Passada Payments',version:'11.2.1',mercadoPagoConfigured:!!MP_TOKEN,mercadoPagoPublicKeyConfigured:!!MP_PUBLIC_KEY,firebaseConfigured:!!db(),adminEmail:ADMIN_EMAIL}));
app.get('/payments/config',(req,res)=>res.json({publicKey:MP_PUBLIC_KEY}));
app.post('/payments/create',async(req,res)=>{try{
 if(!MP_TOKEN||!db())return res.status(503).json({message:'Backend ainda não configurado no Render.'});
 const {plan,userId,email}=req.body||{};
 if(!['vip','life'].includes(plan)||!userId||!email)return res.status(400).json({message:'Dados do pagamento incompletos.'});
 const price=await getPrice(plan); const ref=externalRef(userId,plan);
 await savePaymentUser(userId,{pendingPlan:plan,pendingReference:ref});
 res.json({ok:true,plan,amount:price,reference:ref});
 }catch(e){console.error(e);res.status(e.status||500).json({message:e.message||'Erro ao preparar pagamento.'})}});

app.post('/payments/process',async(req,res)=>{try{
 if(!MP_TOKEN||!db())return res.status(503).json({message:'Backend ainda não configurado no Render.'});
 const {plan,userId,email}=req.body||{};
 let payment=req.body?.payment||{};
 // Aceita tanto o formato direto quanto um payload aninhado enviado pelo Brick.
 if(payment?.formData) payment=payment.formData;
 if(!['vip','life'].includes(plan)||!userId||!email||!payment)return res.status(400).json({message:'Dados do pagamento incompletos.'});
 const price=await getPrice(plan); const ref=externalRef(userId,plan);
 const method=String(payment.payment_method_id||payment.paymentMethodId||'').toLowerCase();
 if(!method)return res.status(400).json({message:'Forma de pagamento não identificada.'});
 const payer={email:String(email).toLowerCase()};
 if(payment.payer?.identification?.type && payment.payer?.identification?.number){payer.identification=payment.payer.identification;}
 if(payment.payer?.first_name)payer.first_name=payment.payer.first_name;
 if(payment.payer?.last_name)payer.last_name=payment.payer.last_name;
 // VIP com cartão: cria assinatura recorrente usando o token seguro do Brick.
 if(plan==='vip' && method!=='pix'){
   if(!payment.token)return res.status(400).json({message:'Não foi possível tokenizar o cartão. Tente novamente.'});
   const sub=await mp('/preapproval',{method:'POST',body:JSON.stringify({
     reason:'Curso da Passada — Plano VIP',external_reference:ref,payer_email:payer.email,card_token_id:payment.token,
     auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:price,currency_id:'BRL'},
     back_url:FRONTEND_URL||appUrl(req),status:'authorized'
   })});
   await savePaymentUser(userId,{pendingPlan:'vip',pendingReference:ref,subscriptionId:String(sub.id)});
   return res.json({ok:true,type:'subscription',id:String(sub.id),status:sub.status||'authorized',message:'Assinatura VIP criada com sucesso.'});
 }
 // Pix ou Vitalício com cartão: pagamento único via /v1/payments.
 const body={transaction_amount:price,description:plan==='life'?'Curso da Passada — Acesso Vitalício':'Curso da Passada — VIP (30 dias)',payment_method_id:method,payer,external_reference:ref};
 if(method==='pix'){
   body.payment_type_id='bank_transfer';
 }else{
   if(!payment.token)return res.status(400).json({message:'Não foi possível tokenizar o cartão. Tente novamente.'});
   body.token=payment.token;
   body.installments=Number(payment.installments)||1;
   if(payment.issuer_id)body.issuer_id=String(payment.issuer_id);
 }
 const idempotency=crypto.randomUUID?crypto.randomUUID():crypto.randomBytes(16).toString('hex');
 const result=await mp('/v1/payments',{method:'POST',headers:{'X-Idempotency-Key':idempotency},body:JSON.stringify(body)});
 await savePaymentUser(userId,{pendingPlan:plan,pendingReference:ref,lastPaymentId:String(result.id),lastPaymentStatus:result.status||'pending'});
 const tx=result.point_of_interaction?.transaction_data||{};
 return res.json({ok:true,type:method==='pix'?'pix':'card',id:String(result.id),status:result.status,status_detail:result.status_detail,qr_code:tx.qr_code||null,qr_code_base64:tx.qr_code_base64||null,ticket_url:tx.ticket_url||null,message:result.status==='approved'?'Pagamento aprovado!':'Pagamento criado. Aguarde a confirmação.'});
 }catch(e){console.error('Process payment:',e.data||e);res.status(e.status||500).json({message:e.message||'Erro ao processar pagamento.',details:e.data||null})}});

app.get('/payments/status/:id',async(req,res)=>{try{
 const id=encodeURIComponent(req.params.id); const p=await mp('/v1/payments/'+id);
 res.json({id:String(p.id),status:p.status,status_detail:p.status_detail,external_reference:p.external_reference||null});
 }catch(e){res.status(e.status||500).json({message:e.message||'Não foi possível consultar o pagamento.'})}});

app.get('/subscriptions/status/:id',async(req,res)=>{try{
 const id=encodeURIComponent(req.params.id); const s=await mp('/preapproval/'+id);
 res.json({id:String(s.id),status:s.status,external_reference:s.external_reference||null});
 }catch(e){res.status(e.status||500).json({message:e.message||'Não foi possível consultar a assinatura.'})}});

async function processPayment(paymentId){const p=await mp('/v1/payments/'+paymentId);const ref=String(p.external_reference||'');const m=ref.match(/^CDP-(vip|life)-(.+?)-\d+$/);if(!m)return {ignored:true,reason:'external_reference não reconhecida'};const plan=m[1],userId=m[2];if(p.status==='approved'){const now=new Date();if(plan==='life'){await savePaymentUser(userId,{plan:'life',expiresAt:null,pendingPlan:null,pendingReference:null,lastPaymentId:String(p.id),lastPaymentStatus:p.status})}else{let until=new Date(now.getTime()+31*86400000);const snap=await db().ref('course/users/'+userId).once('value');const old=snap.val()||{};if(old.expiresAt&&new Date(old.expiresAt)>now)until=new Date(new Date(old.expiresAt).getTime()+31*86400000);await savePaymentUser(userId,{plan:'vip',expiresAt:until.toISOString(),pendingPlan:null,pendingReference:null,lastPaymentId:String(p.id),lastPaymentStatus:p.status})}}
 return {status:p.status,userId,plan};}
async function processSubscription(id){const s=await mp('/preapproval/'+encodeURIComponent(id));const ref=String(s.external_reference||'');const m=ref.match(/^CDP-vip-(.+?)-\d+$/);if(!m)return {ignored:true};const userId=m[1];if(s.status==='authorized'){let until=new Date(Date.now()+31*86400000);const snap=await db().ref('course/users/'+userId).once('value');const old=snap.val()||{};if(old.expiresAt&&new Date(old.expiresAt)>until)until=new Date(old.expiresAt);await savePaymentUser(userId,{plan:'vip',expiresAt:until.toISOString(),subscriptionId:String(id),lastSubscriptionStatus:s.status})}else if(['cancelled','canceled','paused'].includes(s.status)){await savePaymentUser(userId,{plan:'free',expiresAt:new Date(0).toISOString(),subscriptionId:String(id),lastSubscriptionStatus:s.status})}return {status:s.status,userId};}
function verifyWebhook(req){if(!MP_WEBHOOK_SECRET)return true;const sig=req.get('x-signature')||'';const requestId=req.get('x-request-id')||'';const dataId=String(req.body?.data?.id||'');const ts=(sig.match(/ts=([^,]+)/)||[])[1];const v1=(sig.match(/v1=([^,]+)/)||[])[1];if(!ts||!v1||!dataId)return false;const manifest=`id:${dataId};request-id:${requestId};ts:${ts};`;const h=crypto.createHmac('sha256',MP_WEBHOOK_SECRET).update(manifest).digest('hex');return crypto.timingSafeEqual(Buffer.from(h),Buffer.from(v1));}
app.post('/webhooks/mercadopago',async(req,res)=>{res.sendStatus(200);try{if(!verifyWebhook(req)){console.warn('Webhook Mercado Pago com assinatura inválida');return}const type=req.body?.type||req.body?.topic,id=req.body?.data?.id||req.body?.id;if(!id)return;if(type==='payment'||type==='merchant_order'||type==='payment.updated')await processPayment(id);else if(String(type).includes('subscription')||String(type).includes('preapproval'))await processSubscription(id);else {try{await processPayment(id)}catch{}try{await processSubscription(id)}catch{}}}catch(e){console.error('Webhook:',e.message)}});
// O Render é usado como API. Só serve o PWA se a pasta public existir.
// Assim o backend não cai com ENOENT quando for publicado separado do site.
const publicDir=path.join(__dirname,'public');
const fs=require('fs');
if(fs.existsSync(path.join(publicDir,'index.html'))){
  app.use(express.static(publicDir));
  app.get('*',(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
}else{
  app.get('/',(req,res)=>res.json({online:true,service:'Curso da Passada Payments',api:true,version:'11.1.2'}));
}
app.listen(PORT,()=>console.log(`Curso da Passada rodando na porta ${PORT}`));
