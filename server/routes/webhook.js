const express = require('express');
const { query } = require('../db');
const TelegramAdapter = require('../services/channels/telegram');
const WhatsAppAdapter = require('../services/channels/whatsapp');
const { processIncomingMessage } = require('../services/chatbot/flowEngine');
const {
  extractIdentity,
  extractStatusIdentity,
  resolveIdentity,
} = require('../services/whatsappIdentity');
const { getTenantWhatsAppConfig } = require('../services/whatsapp');

const router = express.Router();
const DEFAULT_TENANT_ID = Number(process.env.DEFAULT_TENANT_ID || 1);

function getTelegramAdapter() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN no configurado');
  }
  return new TelegramAdapter(token);
}

async function getWhatsAppAdapter(tenantId) {
  const config = await getTenantWhatsAppConfig(tenantId);
  return new WhatsAppAdapter(config);
}

async function recordWhatsappStatus(tenantId, statusItem, identity) {
  const bsuid = identity?.bsuid || null;
  if (!statusItem?.id) return;

  await query(
    `UPDATE messages m
     JOIN conversations c ON c.id = m.conversation_id
     SET m.bsuid = COALESCE(?, m.bsuid),
         m.metadata = JSON_SET(
           COALESCE(m.metadata, JSON_OBJECT()),
           '$.last_status', ?,
           '$.last_status_timestamp', ?,
           '$.status_recipient_id', ?,
           '$.status_recipient_user_id', ?
         )
     WHERE c.tenant_id = ? AND m.wa_message_id = ?`,
    [
      bsuid,
      statusItem.status || null,
      String(statusItem.timestamp || ''),
      statusItem.recipient_id || null,
      statusItem.recipient_user_id || null,
      tenantId,
      statusItem.id,
    ]
  ).catch((err) => {
    console.error('[webhook/whatsapp] status log update skipped:', err.message);
  });

  if (bsuid) {
    await query(
      `UPDATE conversations c
       JOIN messages m ON m.conversation_id = c.id
       SET c.bsuid = COALESCE(?, c.bsuid)
       WHERE c.tenant_id = ? AND m.wa_message_id = ?`,
      [bsuid, tenantId, statusItem.id]
    ).catch(() => {});
  }
}

async function handleWhatsAppWebhook(body, tenantId) {
  const adapter = await getWhatsAppAdapter(tenantId);
  const parsed = adapter.parseWebhookPayload(body);

  for (const item of parsed) {
    const value = item.value || {};
    const sourceWabaId = String(item.entry?.id || '') || null;
    const sourcePhoneNumberId = String(value.metadata?.phone_number_id || '') || null;

    if (item.status) {
      const identityData = extractStatusIdentity(item.status);
      if (identityData.bsuid && !identityData.phone) {
        console.warn('[webhook/whatsapp] BSUID recibido en status sin teléfono', {
          bsuid: identityData.bsuid,
          status: item.status.status || null,
          message_id: item.status.id || null,
        });
      }

      const resolvedIdentity = (identityData.phone || identityData.bsuid)
        ? await resolveIdentity({
            tenantId,
            ...identityData,
            sourceWabaId,
            sourcePhoneNumberId,
          }).catch((err) => {
            console.error('[webhook/whatsapp] resolveIdentity(status) failed:', err.stack || err.message || err);
            return null;
          })
        : null;

      await recordWhatsappStatus(tenantId, item.status, resolvedIdentity || identityData);
      continue;
    }

    const msg = item.message || {};
    const incoming = item.incoming;
    if (!incoming) {
      continue;
    }

    const identityData = extractIdentity(msg, value);
    if (identityData.bsuid && !identityData.phone) {
      console.warn('[webhook/whatsapp] BSUID recibido sin teléfono', {
        bsuid: identityData.bsuid,
        message_id: msg.id || null,
        type: msg.type || null,
      });
    }

    const resolvedIdentity = await resolveIdentity({
      tenantId,
      ...identityData,
      displayName: incoming.senderName || null,
      sourceWabaId,
      sourcePhoneNumberId,
    });

    await processIncomingMessage({
      tenantId,
      incoming: {
        ...incoming,
        channel: adapter.channelName,
        identity: resolvedIdentity,
        replyTarget: {
          phone: resolvedIdentity?.phone || identityData.phone || null,
          bsuid: resolvedIdentity?.bsuid || identityData.bsuid || null,
          preferPhone: Boolean(resolvedIdentity?.phone || identityData.phone),
        },
        metadataSource: 'whatsapp-webhook',
      },
      channelAdapter: adapter,
    });
  }
}

// POST /api/webhook/telegram — recibe mensajes de Telegram
router.post('/telegram', async (req, res) => {
  res.sendStatus(200);

  let adapter;
  try {
    adapter = getTelegramAdapter();
  } catch (err) {
    console.error('[webhook/telegram]', err.message);
    return;
  }

  try {
    const incoming = adapter.parseIncoming(req.body);

    if (!incoming) {
      return;
    }

    if (incoming.text === '/start') {
      incoming.text = '';
    }

    if (incoming.contentType === 'button_reply' && req.body.callback_query) {
      await adapter.answerCallback(req.body.callback_query.id);
    }

    try {
      await processIncomingMessage({
        tenantId: DEFAULT_TENANT_ID,
        incoming: {
          ...incoming,
          channel: adapter.channelName,
          metadataSource: 'telegram-webhook',
        },
        channelAdapter: adapter,
      });
    } catch (err) {
      console.error('[webhook/telegram] processIncomingMessage failed:', err.stack || err.message || err);
      if (incoming.senderId) {
        try {
          await adapter.sendText(
            incoming.senderId,
            'Hubo un error procesando tu mensaje o comprobante. Intenta reenviarlo en unos segundos.'
          );
        } catch (sendErr) {
          console.error('[webhook/telegram] fallback send failed:', sendErr.stack || sendErr.message || sendErr);
        }
      }
    }
  } catch (err) {
    console.error('[webhook/telegram] Error:', err.stack || err.message || err);
  }
});

// GET /api/webhook/telegram/setup — configura el webhook en Telegram
router.get('/telegram/setup', async (req, res) => {
  try {
    const adapter = getTelegramAdapter();
    const host = req.get('host');
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const webhookUrl = `${protocol}://${host}/api/webhook/telegram`;
    const result = await adapter.setWebhook(webhookUrl);

    res.json({
      webhook_url: webhookUrl,
      telegram_response: result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'No se pudo configurar el webhook de Telegram' });
  }
});

// GET /api/webhook/whatsapp — verificación de Meta webhook
router.get('/whatsapp', async (req, res) => {
  try {
    const config = await getTenantWhatsAppConfig(DEFAULT_TENANT_ID);
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && config.verifyToken && token === config.verifyToken) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  } catch (err) {
    console.error('[webhook/whatsapp GET]', err.stack || err.message || err);
    return res.sendStatus(500);
  }
});

// POST /api/webhook/whatsapp — recibe eventos de Meta/WhatsApp
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200);

  try {
    await handleWhatsAppWebhook(req.body, DEFAULT_TENANT_ID);
  } catch (err) {
    console.error('[webhook/whatsapp] Error:', err.stack || err.message || err);
  }
});

module.exports = router;
