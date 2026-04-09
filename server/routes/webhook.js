const express = require('express');
const TelegramAdapter = require('../services/channels/telegram');
const { processIncomingMessage } = require('../services/chatbot/flowEngine');

const router = express.Router();

// POST /api/webhook/telegram — recibe mensajes de Telegram
router.post('/telegram', async (req, res) => {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET || 'bos_tg_webhook_secret_2026';
  const receivedSecret = req.headers['x-telegram-bot-api-secret-token'];
  if (receivedSecret !== expectedSecret) {
    return res.sendStatus(403);
  }

  // Responder 200 inmediatamente (Telegram reintenta si no)
  res.sendStatus(200);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[webhook/telegram] TELEGRAM_BOT_TOKEN no configurado');
    return;
  }

  try {
    const adapter = new TelegramAdapter(token);
    const incoming = adapter.parseIncoming(req.body);

    if (!incoming) {
      return; // Update sin mensaje (edición de bot, etc.)
    }

    if (incoming.text === '/start') {
      incoming.text = '';
    }

    // Si es callback_query, responder para quitar el loading del botón
    if (incoming.contentType === 'button_reply' && req.body.callback_query) {
      await adapter.answerCallback(req.body.callback_query.id);
    }

    // Procesar con el engine (tenant 1 = Daniel)
    await processIncomingMessage({
      tenantId: 1,
      incoming: {
        ...incoming,
        channel: adapter.channelName,
      },
      channelAdapter: adapter,
    });

  } catch (err) {
    console.error('[webhook/telegram] Error:', err);
  }
});

// GET /api/webhook/telegram/setup — configura el webhook en Telegram
router.get('/telegram/setup', async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN no configurado' });
  }

  // Detectar URL base del servidor
  const host = req.get('host');
  const protocol = req.get('x-forwarded-proto') || req.protocol;
  const webhookUrl = `${protocol}://${host}/api/webhook/telegram`;

  const adapter = new TelegramAdapter(token);
  const result = await adapter.setWebhook(webhookUrl);

  res.json({
    webhook_url: webhookUrl,
    telegram_response: result,
  });
});

module.exports = router;
