const ChannelAdapter = require('./base');
const {
  getTenantWhatsAppConfig,
  resolveWhatsAppConfig,
  sendButtonsMessage,
  sendImageMessage,
  sendTemplateMessage,
  sendTextMessage,
} = require('../whatsapp');
const { extractIdentity } = require('../whatsappIdentity');

function buildSenderName(msg = {}, value = {}) {
  const contacts = Array.isArray(value.contacts) ? value.contacts : [];
  const contact = contacts[0] || {};
  return (
    contact.profile?.name ||
    msg.profile?.name ||
    msg.sender_name ||
    null
  );
}

class WhatsAppAdapter extends ChannelAdapter {
  constructor(config = {}) {
    super();
    this.config = resolveWhatsAppConfig(config);
  }

  static async forTenant(tenantId) {
    const config = await getTenantWhatsAppConfig(tenantId);
    return new WhatsAppAdapter(config);
  }

  get channelName() {
    return 'whatsapp';
  }

  parseIncoming(body) {
    const parsed = this.parseWebhookPayload(body);
    return parsed[0]?.incoming || null;
  }

  parseWebhookPayload(body = {}) {
    const items = [];
    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change.value || {};
        const messages = Array.isArray(value.messages) ? value.messages : [];
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];

        for (const message of messages) {
          const incoming = this.parseIncomingMessage(message, value);
          if (incoming) {
            items.push({ entry, change, value, message, incoming });
          }
        }

        for (const status of statuses) {
          items.push({ entry, change, value, status });
        }
      }
    }

    return items;
  }

  parseIncomingMessage(msg = {}, value = {}) {
    if (!msg?.id) return null;

    const identity = extractIdentity(msg, value);
    const incoming = {
      senderId: identity.phone || identity.bsuid || '',
      senderName: buildSenderName(msg, value),
      text: '',
      messageId: String(msg.id),
      contentType: msg.type || 'text',
      raw: { message: msg, value },
      identity,
      replyTarget: {
        phone: identity.phone,
        bsuid: identity.bsuid,
        preferPhone: Boolean(identity.phone),
      },
    };

    switch (msg.type) {
      case 'text':
        incoming.text = msg.text?.body || '';
        break;
      case 'image':
        incoming.text = msg.image?.caption || '[imagen]';
        incoming.mediaFileId = msg.image?.id || null;
        incoming.mimeType = msg.image?.mime_type || 'image/jpeg';
        incoming.filename = `image-${msg.id}`;
        break;
      case 'document':
        incoming.text = msg.document?.caption || '[documento]';
        incoming.mediaFileId = msg.document?.id || null;
        incoming.mimeType = msg.document?.mime_type || 'application/octet-stream';
        incoming.filename = msg.document?.filename || `document-${msg.id}`;
        break;
      case 'audio':
        incoming.text = '[audio]';
        incoming.mediaFileId = msg.audio?.id || null;
        incoming.mimeType = msg.audio?.mime_type || 'audio/ogg';
        incoming.filename = `audio-${msg.id}`;
        break;
      case 'button':
        incoming.text = msg.button?.payload || msg.button?.text || '';
        incoming.contentType = 'button_reply';
        break;
      case 'interactive':
        if (msg.interactive?.button_reply) {
          incoming.text = msg.interactive.button_reply.id || msg.interactive.button_reply.title || '';
          incoming.contentType = 'button_reply';
        } else if (msg.interactive?.list_reply) {
          incoming.text = msg.interactive.list_reply.id || msg.interactive.list_reply.title || '';
          incoming.contentType = 'button_reply';
        } else {
          incoming.text = '[interactivo]';
        }
        break;
      default:
        incoming.text = msg.caption || `[${msg.type || 'mensaje'}]`;
        break;
    }

    return incoming;
  }

  async sendText(recipientOrTarget, text) {
    const data = await sendTextMessage(this.config, recipientOrTarget, text);
    return { messageId: String(data?.messages?.[0]?.id || '') };
  }

  async sendTemplate(recipientOrTarget, templateName, options = {}) {
    const data = await sendTemplateMessage(this.config, recipientOrTarget, templateName, options);
    return { messageId: String(data?.messages?.[0]?.id || '') };
  }

  async sendButtons(recipientOrTarget, text, buttons) {
    const data = await sendButtonsMessage(this.config, recipientOrTarget, text, buttons);
    return { messageId: String(data?.messages?.[0]?.id || '') };
  }

  async sendImage(recipientOrTarget, image, caption = '', mimeType = 'image/png') {
    const data = await sendImageMessage(this.config, recipientOrTarget, image, {
      caption,
      mimeType,
      filename: 'image',
    });
    return { messageId: String(data?.messages?.[0]?.id || '') };
  }

  async getMedia(mediaId, options = {}) {
    const response = await fetch(`https://graph.facebook.com/${this.config.apiVersion}/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    });
    const metadata = await response.json();
    if (!response.ok || metadata.error) {
      throw new Error(metadata?.error?.message || 'No se pudo obtener media de WhatsApp');
    }

    const download = await fetch(metadata.url, {
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    });
    if (!download.ok) {
      throw new Error(`No se pudo descargar media de WhatsApp (${download.status})`);
    }

    const arrayBuffer = await download.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: options.mimeType || metadata.mime_type || download.headers.get('content-type') || 'application/octet-stream',
      filename: options.filename || metadata.sha256 || `wa-media-${mediaId}`,
    };
  }
}

module.exports = WhatsAppAdapter;
