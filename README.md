# Curso da Passada — Backend seguro v12.0.0

Backend Express para autenticação e pagamentos do Curso da Passada.

## Variáveis obrigatórias no Render

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_DATABASE_URL`
- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_PUBLIC_KEY`
- `ADMIN_EMAIL` (opcional; padrão: `diel_zi_nho25@hotmail.com`)
- `FRONTEND_URL` (recomendado: `https://edielrodrigues.github.io/Curso-da-Passada`)
- `MERCADO_PAGO_WEBHOOK_SECRET` (recomendado quando configurado no Mercado Pago)

## Alteração obrigatória no frontend

As rotas `/payments/create`, `/payments/process`, `/payments/status/:id` e `/subscriptions/status/:id` agora exigem:

`Authorization: Bearer <Firebase ID Token>`

O frontend deve obter o ID Token do Firebase Auth com `currentUser.getIdToken()` e enviá-lo nas chamadas ao backend. O `userId` e o e-mail não devem mais ser enviados como autoridade de identidade.

## Firebase Rules

Importe `firebase-rules.json` no Realtime Database. As regras impedem que um usuário altere sozinho campos de plano/pagamento e limitam as aulas pagas a usuários com VIP válido ou Vitalício.

Para a aula gratuita, marque a aula de depoimento com `isFree: true` (ou `access: "free"`).

## Segurança

- Tokens de cartão nunca são armazenados no backend.
- O backend verifica o Firebase ID Token.
- O `uid` usado em pagamentos vem do token autenticado.
- Referências de pagamento são vinculadas ao usuário e expiram após 30 minutos.
- Consultas de pagamentos/assinaturas são vinculadas ao usuário autenticado.
- CORS não aceita qualquer origem arbitrária.
- Webhook aceita assinatura HMAC quando `MERCADO_PAGO_WEBHOOK_SECRET` estiver configurado.
- Processamento aprovado atualiza o plano no Firebase Admin.
