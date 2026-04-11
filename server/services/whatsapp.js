const { query } = require('../db');
const { normalizeBsuid, normalizePhone } = require('./whatsappIdentity');

const GRAPH_API_VERSION = 'v22.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function resolveWhatsAppConfig(rawConfig = {}) {
  const waConfig = parseJson(rawConfig.wa_config, rawConfig.wa_config || {});
  const metaConfig = parseJson(rawConfig.meta_config, rawConfig.meta_config || {});

  return {
    accessToken: firstDefined(
      rawConfig.accessToken,
      waConfig.access_token,
      waConfig.token,
      metaConfig.access_token,
      metaConfig.token,
      process.env.WHATSAPP_ACCESS_TOKEN,
      process.env.META_ACCESS_TOKEN,
      process.env.WA_TOKEN        // compatibilidad con naming de agenda4.0
    ),
    phoneNumberId: firstDefined(
      rawConfig.phoneNumberId,
      waConfig.phone_number_id,
      metaConfig.phone_number_id,
      process.env.WHATSAPP_PHONE_NUMBER_ID,
      process.env.META_PHONE_NUMBER_ID,
      process.env.WA_PHONE_ID     // compatibilidad con naming de agenda4.0
    ),
    businessAccountId: firstDefined(
      rawConfig.businessAccountId,
      waConfig.business_account_id,
      waConfig.waba_id,
      metaConfig.business_account_id,
      metaConfig.waba_id,
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      process.env.WHATSAPP_WABA_ID,
      process.env.META_WABA_ID
    ),
    verifyToken: firstDefined(
      rawConfig.verifyToken,
      waConfig.verify_token,
      metaConfig.verify_token,
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
      process.env.META_WEBHOOK_VERIFY_TOKEN,
      process.env.META_VERIFY_TOKEN
    ),
    appSecret: firstDefined(
      rawConfig.appSecret,
      waConfig.app_secret,
      metaConfig.app_secret,
      process.env.META_APP_SECRET
    ),
    apiVersion: GRAPH_API_VERSION,
  };
}

async function getTenantWhatsAppConfig(tenantId) {
  const rows = await query(
    'SELECT wa_config, meta_config FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );
  return resolveWhatsAppConfig(rows[0] || {});
}

function normalizeTarget(targetOrPhone) {
  if (typeof targetOrPhone === 'string') {
    return {
      phone: normalizePhone(targetOrPhone),
      bsuid: null,
    };
  }

  if (targetOrPhone && typeof targetOrPhone === 'object') {
    return {
      phone: normalizePhone(targetOrPhone.phone || targetOrPhone.to),
      bsuid: normalizeBsuid(targetOrPhone.bsuid || targetOrPhone.recipient),
    };
  }

  return {
    phone: null,
    bsuid: null,
  };
}

function buildRecipientFields({ phone, bsuid }) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedBsuid = normalizeBsuid(bsuid);

  if (normalizedPhone) {
    return { to: normalizedPhone };
  }

  if (normalizedBsuid) {
    return { recipient: normalizedBsuid };
  }

  throw new Error('Target inválido: se requiere phone o bsuid');
}

function ensureConfig(config) {
  const resolved = resolveWhatsAppConfig(config);
  if (!resolved.accessToken) {
    throw new Error('WhatsApp access token no configurado');
  }
  if (!resolved.phoneNumberId) {
    throw new Error('WhatsApp phone_number_id no configurado');
  }
  return resolved;
}

async function graphRequest(config, path, payload, { method = 'POST', formData = null } = {}) {
  const resolved = ensureConfig(config);
  const headers = {
    Authorization: `Bearer ${resolved.accessToken}`,
  };

  const response = await fetch(`${GRAPH_API_BASE}${path}`, {
    method,
    headers: formData ? headers : {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: formData || JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    const message = data?.error?.message || `WhatsApp Graph API error ${response.status}`;
    const error = new Error(message);
    error.response = data;
    throw error;
  }

  return data;
}

async function uploadMedia(config, buffer, mimeType = 'application/octet-stream', filename = 'upload.bin') {
  const resolved = ensureConfig(config);
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);

  return graphRequest(
    resolved,
    `/${resolved.phoneNumberId}/media`,
    null,
    { method: 'POST', formData }
  );
}

async function sendTextMessage(config, phoneOrTarget, text, options = {}) {
  const resolved = ensureConfig(config);
  const target = normalizeTarget(phoneOrTarget);
  return graphRequest(resolved, `/${resolved.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...buildRecipientFields(target),
    type: 'text',
    text: {
      body: String(text || ''),
      preview_url: options.previewUrl === true,
    },
  });
}

async function sendTemplateMessage(config, phoneOrTarget, templateName, options = {}) {
  const resolved = ensureConfig(config);
  const target = normalizeTarget(phoneOrTarget);

  return graphRequest(resolved, `/${resolved.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...buildRecipientFields(target),
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: options.languageCode || 'es',
      },
      components: Array.isArray(options.components) ? options.components : [],
    },
  });
}

async function sendImageMessage(config, phoneOrTarget, image, options = {}) {
  const resolved = ensureConfig(config);
  const target = normalizeTarget(phoneOrTarget);
  let imagePayload = null;

  if (Buffer.isBuffer(image)) {
    const upload = await uploadMedia(
      resolved,
      image,
      options.mimeType || 'image/png',
      options.filename || 'image'
    );
    imagePayload = { id: upload.id };
  } else if (looksLikeUrl(image)) {
    imagePayload = { link: image };
  } else {
    imagePayload = { id: String(image || '') };
  }

  if (options.caption) {
    imagePayload.caption = options.caption;
  }

  return graphRequest(resolved, `/${resolved.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...buildRecipientFields(target),
    type: 'image',
    image: imagePayload,
  });
}

async function sendButtonsMessage(config, phoneOrTarget, text, buttons = []) {
  const resolved = ensureConfig(config);
  const target = normalizeTarget(phoneOrTarget);

  return graphRequest(resolved, `/${resolved.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    ...buildRecipientFields(target),
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(text || '') },
      action: {
        buttons: buttons.slice(0, 3).map((button) => ({
          type: 'reply',
          reply: {
            id: String(button.id),
            title: String(button.label).slice(0, 20),
          },
        })),
      },
    },
  });
}

module.exports = {
  GRAPH_API_VERSION,
  resolveWhatsAppConfig,
  getTenantWhatsAppConfig,
  buildRecipientFields,
  sendTextMessage,
  sendTemplateMessage,
  sendImageMessage,
  sendButtonsMessage,
  uploadMedia,
  graphRequest,
};
