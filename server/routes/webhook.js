const express = require('express');
const TelegramAdapter = require('../services/channels/telegram');
const ChatbotEngine = require('../services/chatbot/engine');

const router = express.Router();

// POST /api/webhook/telegram — recibe mensajes de Telegram
router.post('/telegram', async (req, res) => {
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

    // Ignorar comandos de bot como /start
    if (incoming.text === '/start') {
      await adapter.sendText(incoming.senderId,
        'Hola! Soy el asistente de Daniel MacLean. ¿En qué puedo ayudarte?');
      return;
    }

    // Si es callback_query, responder para quitar el loading del botón
    if (incoming.contentType === 'button_reply' && req.body.callback_query) {
      await adapter.answerCallback(req.body.callback_query.id);
    }

    // Procesar con el engine (tenant 1 = Daniel)
    const engine = new ChatbotEngine(adapter, 1);
    await engine.handleMessage(incoming);

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
