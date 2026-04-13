const crypto = require('crypto');
const { query } = require('../db');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DB_CHUNK_SIZE = 500;
const SHEETS_APPEND_CHUNK_SIZE = 400;
const DEFAULT_MAX_CONVERSATION_ROWS = 60000;

class GoogleSheetsConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GoogleSheetsConfigError';
  }
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function parseJsonSafely(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizePrivateKey(value) {
  if (!value) return '';
  return String(value).replace(/\\n/g, '\n');
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function toA1Range(sheetTitle, range) {
  const escapedTitle = String(sheetTitle).replaceAll("'", "''");
  return `'${escapedTitle}'!${range}`;
}

function normalizeSheetValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function resolveSheetsConfig(tenant) {
  const googleConfig = parseJsonSafely(tenant?.google_config) || {};

  const spreadsheetId = pickFirstDefined(
    process.env.GOOGLE_SHEETS_ID,
    process.env.GOOGLE_SPREADSHEET_ID,
    process.env.GOOGLE_SHEET_ID,
    googleConfig.sheets_id,
    googleConfig.spreadsheet_id,
    googleConfig.sheet_id
  );

  if (!spreadsheetId) {
    throw new GoogleSheetsConfigError(
      'Falta GOOGLE_SHEETS_ID (o GOOGLE_SPREADSHEET_ID) para exportar a Google Sheets.'
    );
  }

  const serviceAccountJsonRaw = pickFirstDefined(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON,
    googleConfig.service_account_json
  );

  const serviceAccountJson = parseJsonSafely(serviceAccountJsonRaw);
  const serviceAccountEmail = pickFirstDefined(
    process.env.GOOGLE_CLIENT_EMAIL,
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    googleConfig.client_email,
    serviceAccountJson?.client_email
  );
  const serviceAccountPrivateKey = normalizePrivateKey(
    pickFirstDefined(
      process.env.GOOGLE_PRIVATE_KEY,
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      googleConfig.private_key,
      serviceAccountJson?.private_key
    )
  );

  if (serviceAccountEmail && serviceAccountPrivateKey) {
    return {
      spreadsheetId: String(spreadsheetId).trim(),
      auth: {
        type: 'service_account',
        clientEmail: String(serviceAccountEmail).trim(),
        privateKey: serviceAccountPrivateKey,
      },
    };
  }

  const clientId = pickFirstDefined(
    process.env.GOOGLE_CLIENT_ID,
    googleConfig.client_id
  );
  const clientSecret = pickFirstDefined(
    process.env.GOOGLE_CLIENT_SECRET,
    googleConfig.client_secret
  );
  const refreshToken = pickFirstDefined(
    process.env.GOOGLE_REFRESH_TOKEN,
    googleConfig.refresh_token
  );

  if (clientId && clientSecret && refreshToken) {
    return {
      spreadsheetId: String(spreadsheetId).trim(),
      auth: {
        type: 'refresh_token',
        clientId: String(clientId).trim(),
        clientSecret: String(clientSecret).trim(),
        refreshToken: String(refreshToken).trim(),
      },
    };
  }

  throw new GoogleSheetsConfigError(
    'Faltan credenciales de Google. Configura GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY (recomendado) o GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN.'
  );
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestServiceAccountAccessToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const assertion = `${unsigned}.${signature}`;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  const data = await parseResponseBody(response);
  if (!response.ok || !data.access_token) {
    throw new Error(
      `[Google OAuth] No se pudo obtener token de service account: ${data?.error_description || data?.error || response.statusText}`
    );
  }
  return data.access_token;
}

async function requestRefreshTokenAccessToken(clientId, clientSecret, refreshToken) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });

  const data = await parseResponseBody(response);
  if (!response.ok || !data.access_token) {
    throw new Error(
      `[Google OAuth] No se pudo refrescar token: ${data?.error_description || data?.error || response.statusText}`
    );
  }
  return data.access_token;
}

async function getGoogleAccessToken(config) {
  if (config.auth.type === 'service_account') {
    return requestServiceAccountAccessToken(
      config.auth.clientEmail,
      config.auth.privateKey
    );
  }

  return requestRefreshTokenAccessToken(
    config.auth.clientId,
    config.auth.clientSecret,
    config.auth.refreshToken
  );
}

async function sheetsRequest({ accessToken, spreadsheetId, method = 'GET', path = '', body }) {
  const url = `${SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}${path}`;
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await parseResponseBody(response);
    if (response.ok) {
      return data;
    }

    const isRetryable = response.status === 429 || response.status >= 500;
    if (isRetryable && attempt < maxAttempts) {
      const waitMs = attempt * 700;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    const detail = data?.error?.message || data?.raw || response.statusText;
    throw new Error(`[Google Sheets] ${response.status}: ${detail}`);
  }
}

async function ensureSheetExists(ctx, sheetTitle) {
  if (ctx.sheetTitles.has(sheetTitle)) return;

  await sheetsRequest({
    accessToken: ctx.accessToken,
    spreadsheetId: ctx.spreadsheetId,
    method: 'POST',
    path: ':batchUpdate',
    body: {
      requests: [{ addSheet: { properties: { title: sheetTitle } } }],
    },
  });

  ctx.sheetTitles.add(sheetTitle);
}

async function clearSheet(ctx, sheetTitle) {
  const range = toA1Range(sheetTitle, 'A:ZZ');
  await sheetsRequest({
    accessToken: ctx.accessToken,
    spreadsheetId: ctx.spreadsheetId,
    method: 'POST',
    path: `/values/${encodeURIComponent(range)}:clear`,
    body: {},
  });
}

async function writeSheetHeader(ctx, sheetTitle, headers) {
  const range = toA1Range(sheetTitle, 'A1');
  await sheetsRequest({
    accessToken: ctx.accessToken,
    spreadsheetId: ctx.spreadsheetId,
    method: 'PUT',
    path: `/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    body: {
      majorDimension: 'ROWS',
      values: [headers.map(normalizeSheetValue)],
    },
  });
}

async function appendRows(ctx, sheetTitle, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;

  for (let i = 0; i < rows.length; i += SHEETS_APPEND_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + SHEETS_APPEND_CHUNK_SIZE);
    const range = toA1Range(sheetTitle, 'A2');
    await sheetsRequest({
      accessToken: ctx.accessToken,
      spreadsheetId: ctx.spreadsheetId,
      method: 'POST',
      path: `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      body: {
        majorDimension: 'ROWS',
        values: chunk.map((row) => row.map(normalizeSheetValue)),
      },
    });
  }
}

async function prepareSheet(ctx, sheetTitle, headers) {
  await ensureSheetExists(ctx, sheetTitle);
  await clearSheet(ctx, sheetTitle);
  await writeSheetHeader(ctx, sheetTitle, headers);
}

async function exportContactsSheet(ctx, tenantId) {
  const headers = [
    'contact_id',
    'telefono',
    'wa_name',
    'clean_name',
    'name_quality',
    'label',
    'city',
    'needs_review',
    'review_reason',
    'notes',
    'first_contact_at',
    'last_contact_at',
    'lead_id',
    'lead_nombre',
    'lead_estado',
    'lead_fuente',
    'lead_quality_score',
    'created_at',
    'updated_at',
  ];
  await prepareSheet(ctx, 'Contactos', headers);

  let exported = 0;
  let lastId = 0;

  while (true) {
    const rows = await query(
      `SELECT c.id, c.phone, c.wa_name, c.clean_name, c.name_quality, c.label, c.city,
              c.needs_review, c.review_reason, c.notes, c.first_contact_at, c.last_contact_at,
              c.created_at, c.updated_at,
              l.id AS lead_id, l.name AS lead_name, l.status AS lead_status, l.source AS lead_source, l.quality_score AS lead_quality_score
       FROM contacts c
       LEFT JOIN leads l
         ON l.tenant_id = c.tenant_id
        AND (
          l.contact_id = c.id
          OR (l.contact_id IS NULL AND l.phone IS NOT NULL AND l.phone = c.phone)
        )
       WHERE c.tenant_id = ? AND c.deleted_at IS NULL AND c.id > ?
       ORDER BY c.id ASC
       LIMIT ?`,
      [tenantId, lastId, DB_CHUNK_SIZE]
    );

    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    const values = rows.map((row) => ([
      row.id,
      row.phone,
      row.wa_name,
      row.clean_name,
      row.name_quality,
      row.label,
      row.city,
      row.needs_review,
      row.review_reason,
      row.notes,
      row.first_contact_at,
      row.last_contact_at,
      row.lead_id,
      row.lead_name,
      row.lead_status,
      row.lead_source,
      row.lead_quality_score,
      row.created_at,
      row.updated_at,
    ]));

    await appendRows(ctx, 'Contactos', values);
    exported += values.length;
  }

  return exported;
}

async function exportLeadsSheet(ctx, tenantId) {
  const headers = [
    'lead_id',
    'telefono',
    'nombre',
    'city',
    'source',
    'source_detail',
    'status',
    'quality_score',
    'lifetime_value',
    'workshops_attended',
    'agenda_client_id',
    'notes',
    'first_contact_at',
    'last_contact_at',
    'converted_at',
    'created_at',
    'updated_at',
  ];
  await prepareSheet(ctx, 'Leads', headers);

  let exported = 0;
  let lastId = 0;

  while (true) {
    const rows = await query(
      `SELECT id, phone, name, city, source, source_detail, status, quality_score, lifetime_value,
              workshops_attended, agenda_client_id, notes, first_contact_at, last_contact_at,
              converted_at, created_at, updated_at
       FROM leads
       WHERE tenant_id = ? AND deleted_at IS NULL AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [tenantId, lastId, DB_CHUNK_SIZE]
    );

    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    const values = rows.map((row) => ([
      row.id,
      row.phone,
      row.name,
      row.city,
      row.source,
      row.source_detail,
      row.status,
      row.quality_score,
      row.lifetime_value,
      row.workshops_attended,
      row.agenda_client_id,
      row.notes,
      row.first_contact_at,
      row.last_contact_at,
      row.converted_at,
      row.created_at,
      row.updated_at,
    ]));

    await appendRows(ctx, 'Leads', values);
    exported += values.length;
  }

  return exported;
}

async function exportFinanceSheet(ctx, tenantId) {
  const headers = [
    'registro_tipo',
    'id',
    'fecha',
    'tipo',
    'categoria',
    'subcategoria',
    'monto',
    'moneda',
    'descripcion',
    'lead_id',
    'lead_nombre',
    'lead_telefono',
    'workshop_id',
    'workshop',
    'verificado',
    'metodo_verificacion',
    'meta_periodo_tipo',
    'meta_periodo_inicio',
    'meta_ingreso_objetivo',
    'meta_talleres_objetivo',
    'meta_participantes_objetivo',
    'meta_notas',
    'created_at',
  ];
  await prepareSheet(ctx, 'Finanzas', headers);

  let transactions = 0;
  let goals = 0;
  let lastTransactionId = 0;
  let lastGoalId = 0;

  while (true) {
    const rows = await query(
      `SELECT t.id, t.date, t.type, t.category, t.subcategory, t.amount, t.currency,
              t.description, t.lead_id, l.name AS lead_name, l.phone AS lead_phone,
              t.workshop_id, w.name AS workshop_name, t.verified, t.verification_method, t.created_at
       FROM transactions t
       LEFT JOIN leads l ON l.id = t.lead_id
       LEFT JOIN workshops w ON w.id = t.workshop_id
       WHERE t.tenant_id = ? AND t.id > ?
       ORDER BY t.id ASC
       LIMIT ?`,
      [tenantId, lastTransactionId, DB_CHUNK_SIZE]
    );

    if (rows.length === 0) break;
    lastTransactionId = rows[rows.length - 1].id;

    const values = rows.map((row) => ([
      'transaccion',
      row.id,
      row.date,
      row.type,
      row.category,
      row.subcategory,
      row.amount,
      row.currency,
      row.description,
      row.lead_id,
      row.lead_name,
      row.lead_phone,
      row.workshop_id,
      row.workshop_name,
      row.verified,
      row.verification_method,
      '',
      '',
      '',
      '',
      '',
      '',
      row.created_at,
    ]));

    await appendRows(ctx, 'Finanzas', values);
    transactions += values.length;
  }

  while (true) {
    const rows = await query(
      `SELECT id, period_type, period_start, target_income, target_workshops, target_participants, notes, created_at
       FROM financial_goals
       WHERE tenant_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [tenantId, lastGoalId, DB_CHUNK_SIZE]
    );

    if (rows.length === 0) break;
    lastGoalId = rows[rows.length - 1].id;

    const values = rows.map((row) => ([
      'meta',
      row.id,
      row.period_start,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      row.period_type,
      row.period_start,
      row.target_income,
      row.target_workshops,
      row.target_participants,
      row.notes,
      row.created_at,
    ]));

    await appendRows(ctx, 'Finanzas', values);
    goals += values.length;
  }

  return { transactions, goals };
}

async function exportConversationsSheet(ctx, tenantId) {
  const headers = [
    'log_id',
    'conversation_id',
    'canal',
    'estado_conversacion',
    'inbox_state',
    'asignado_a',
    'lead_id',
    'lead_nombre',
    'lead_telefono',
    'workshop_id',
    'workshop',
    'direccion',
    'sender',
    'bsuid',
    'tipo_contenido',
    'mensaje',
    'metadata',
    'conversation_started_at',
    'conversation_last_message_at',
    'message_created_at',
  ];
  await prepareSheet(ctx, 'Conversaciones', headers);

  const configuredMaxRows = Number(process.env.GOOGLE_SHEETS_MAX_CONVERSATION_ROWS);
  const maxRows = Number.isFinite(configuredMaxRows) && configuredMaxRows > 0
    ? Math.floor(configuredMaxRows)
    : DEFAULT_MAX_CONVERSATION_ROWS;

  let exported = 0;
  let lastMessageId = 0;
  let truncated = false;

  while (true) {
    const remaining = maxRows - exported;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const batchSize = Math.min(DB_CHUNK_SIZE, remaining);
    const rows = await query(
      `SELECT m.id, m.conversation_id, m.direction, m.sender, m.bsuid, m.content_type, m.content, m.metadata, m.created_at,
              c.channel, c.status AS conversation_status, c.inbox_state, c.assigned_to, c.workshop_id, c.started_at, c.last_message_at,
              l.id AS lead_id, l.name AS lead_name, l.phone AS lead_phone,
              w.name AS workshop_name
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN leads l ON l.id = c.lead_id
       LEFT JOIN workshops w ON w.id = c.workshop_id
       WHERE c.tenant_id = ? AND m.id > ?
       ORDER BY m.id ASC
       LIMIT ?`,
      [tenantId, lastMessageId, batchSize]
    );

    if (rows.length === 0) break;
    lastMessageId = rows[rows.length - 1].id;

    const values = rows.map((row) => ([
      row.id,
      row.conversation_id,
      row.channel,
      row.conversation_status,
      row.inbox_state,
      row.assigned_to,
      row.lead_id,
      row.lead_name,
      row.lead_phone,
      row.workshop_id,
      row.workshop_name,
      row.direction,
      row.sender,
      row.bsuid,
      row.content_type,
      row.content,
      parseJsonSafely(row.metadata) || row.metadata,
      row.started_at,
      row.last_message_at,
      row.created_at,
    ]));

    await appendRows(ctx, 'Conversaciones', values);
    exported += values.length;
  }

  return { exported, truncated, maxRows };
}

async function buildSheetsContext(config) {
  const accessToken = await getGoogleAccessToken(config);
  const metadata = await sheetsRequest({
    accessToken,
    spreadsheetId: config.spreadsheetId,
    method: 'GET',
    path: '?fields=sheets(properties(title))',
  });

  const sheetTitles = new Set(
    (metadata.sheets || [])
      .map((sheet) => sheet?.properties?.title)
      .filter(Boolean)
  );

  return {
    accessToken,
    spreadsheetId: config.spreadsheetId,
    sheetTitles,
  };
}

async function exportTenantDataToGoogleSheets({ tenantId, tenant }) {
  const startedAt = Date.now();
  const config = resolveSheetsConfig(tenant);
  const ctx = await buildSheetsContext(config);

  const contacts = await exportContactsSheet(ctx, tenantId);
  const leads = await exportLeadsSheet(ctx, tenantId);
  const finance = await exportFinanceSheet(ctx, tenantId);
  const conversations = await exportConversationsSheet(ctx, tenantId);

  return {
    spreadsheet_id: config.spreadsheetId,
    contacts_rows: contacts,
    leads_rows: leads,
    finance_transaction_rows: finance.transactions,
    finance_goal_rows: finance.goals,
    conversation_rows: conversations.exported,
    conversations_truncated: conversations.truncated,
    conversation_rows_cap: conversations.maxRows,
    duration_ms: Date.now() - startedAt,
  };
}

module.exports = {
  exportTenantDataToGoogleSheets,
  GoogleSheetsConfigError,
};
