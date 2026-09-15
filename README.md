# Curso da Passada V11 — Firebase + ADM + Mercado Pago

## Estrutura
- `public/` = PWA do curso.
- `server.js` = backend para Mercado Pago + webhook.
- `firebase-rules.json` = regras iniciais do Realtime Database.

## ADM
E-mail principal: `diel_zi_nho25@hotmail.com`

## Mercado Pago
- Vitalício: Checkout Pro (Pix e cartão disponíveis no checkout).
- VIP: assinatura mensal via `/preapproval`.
- Webhook: `/webhooks/mercadopago`.

## Variáveis do Render
`MERCADO_PAGO_ACCESS_TOKEN` = Access Token do Mercado Pago (não coloque no GitHub).
`MERCADO_PAGO_WEBHOOK_SECRET` = chave secreta de Webhooks do Mercado Pago (recomendado).
`FIREBASE_DATABASE_URL` = `https://balanco-roupas-eeead-default-rtdb.firebaseio.com`
`FIREBASE_SERVICE_ACCOUNT_JSON` = JSON da conta de serviço do Firebase, em uma única variável.
`FRONTEND_URL` = URL pública do próprio Render, opcional se o frontend for servido pelo mesmo serviço.
`ADMIN_EMAIL` = `diel_zi_nho25@hotmail.com`

## Primeiro acesso ADM
1. Abra o site.
2. Crie uma conta usando `diel_zi_nho25@hotmail.com` e uma senha.
3. O sistema reconhece esse e-mail como ADM.
4. Entre em Painel ADM > Vídeo-aulas.
5. Cadastre título, acesso (Grátis/VIP/Vitalício) e URL do vídeo.

## Firebase
Ative Authentication > Sign-in method > Email/Password.
Depois publique as regras de `firebase-rules.json` no Realtime Database.

## Mercado Pago
No painel de desenvolvedores, pegue o Access Token de teste primeiro para testar. Em produção, troque pelo Access Token de produção no Render. Configure Webhooks para pagamentos e use a URL:
`https://SEU-SERVICO.onrender.com/webhooks/mercadopago`

Nunca coloque Access Token ou Service Account JSON no GitHub.
