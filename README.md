# Curso da Passada — versão 11.1.0

## SITE
- Firebase: balanco-roupas-eeead
- ADM: diel_zi_nho25@hotmail.com
- Backend Render configurado no `public/config.js`:
  `https://backend-curso.onrender.com`

## BACKEND / RENDER
Build Command: `npm install`
Start Command: `npm start`

Variáveis obrigatórias no Render:
- `ADMIN_EMAIL=diel_zi_nho25@hotmail.com`
- `FIREBASE_DATABASE_URL=https://balanco-roupas-eeead-default-rtdb.firebaseio.com`
- `FIREBASE_SERVICE_ACCOUNT_JSON=...`
- `MERCADO_PAGO_ACCESS_TOKEN=...`
- `MERCADO_PAGO_WEBHOOK_SECRET=...` (recomendado)
- `FRONTEND_URL=https://SEU-SITE` (recomendado quando o site estiver publicado separado)

Webhook Mercado Pago:
`https://backend-curso.onrender.com/webhooks/mercadopago`

## FIREBASE
Publique `firebase-rules.json` no Realtime Database. O cliente comum só acessa o próprio perfil; somente o ADM lê `/course/users` inteiro.

## IMPORTANTE
O endpoint `https://backend-curso.onrender.com/health` precisa responder JSON. Se o Render estiver em 503, o serviço ainda não está disponível ou precisa de redeploy/configuração.
