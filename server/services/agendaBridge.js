const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

let cachedPool = null;
let cachedConfig = null;

function resolveAgendaConfig() {
  if (cachedConfig) return cachedConfig;

  const fromEnv = process.env.AGENDA_DB_HOST && process.env.AGENDA_DB_USER && process.env.AGENDA_DB_PASSWORD && process.env.AGENDA_DB_NAME;
  if (fromEnv) {
    cachedConfig = {
      host: process.env.AGENDA_DB_HOST,
      port: Number(process.env.AGENDA_DB_PORT || 3306),
      user: process.env.AGENDA_DB_USER,
      password: process.env.AGENDA_DB_PASSWORD,
      database: process.env.AGENDA_DB_NAME,
      tenantId: Number(process.env.AGENDA_TENANT_ID || 1),
      source: 'env',
    };
    return cachedConfig;
  }

  const localEnvPath = path.join(__dirname, '..', '..', '..', 'agenda4.0', '.env');
  if (fs.existsSync(localEnvPath)) {
    const parsed = dotenv.parse(fs.readFileSync(localEnvPath));
    cachedConfig = {
      host: parsed.DB_HOST,
      port: Number(parsed.DB_PORT || 3306),
      user: parsed.DB_USER,
      password: parsed.DB_PASSWORD,
      database: parsed.DB_NAME,
      tenantId: Number(process.env.AGENDA_TENANT_ID || 1),
      source: 'local-env',
    };
    return cachedConfig;
  }

  cachedConfig = null;
  return null;
}

function getAgendaPool() {
  const config = resolveAgendaConfig();
  if (!config) return null;

  if (!cachedPool) {
    cachedPool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 3,
      queueLimit: 0,
      charset: 'utf8mb4',
      timezone: '-04:00',
    });
  }

  return cachedPool;
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

async function agendaQuery(sql, params = []) {
  const pool = getAgendaPool();
  if (!pool) {
    const err = new Error('Agenda 4.0 no configurada');
    err.code = 'AGENDA_UNAVAILABLE';
    throw err;
  }
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function searchAgendaClients(queryText, limit = 12) {
  const config = resolveAgendaConfig();
  if (!config) return [];

  const query = String(queryText || '').trim();
  if (!query) return [];

  const digits = normalizeDigits(query);
  const likeText = `%${query}%`;
  const likeDigits = `%${digits}%`;

  return agendaQuery(
    `SELECT id, phone, first_name, last_name, city, source, fee, deleted_at
     FROM clients
     WHERE tenant_id = ?
       AND deleted_at IS NULL
       AND (
         CONCAT(first_name, ' ', last_name) LIKE ?
         OR CONCAT(last_name, ' ', first_name) LIKE ?
         OR REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '(', '') LIKE ?
       )
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [config.tenantId, likeText, likeText, likeDigits || '%', Number(limit)]
  );
}

async function getAgendaClientBundle({ agendaClientId = null, phone = '', name = '' } = {}) {
  const config = resolveAgendaConfig();
  if (!config) return { configured: false, source: null, client: null, appointments: [], payments: [], matches: [] };

  let client = null;
  let matches = [];

  if (agendaClientId) {
    const rows = await agendaQuery(
      `SELECT id, phone, first_name, last_name, city, source, fee, notes, status_override, created_at
       FROM clients
       WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL
       LIMIT 1`,
      [config.tenantId, agendaClientId]
    );
    client = rows[0] || null;
  }

  if (!client && phone) {
    const digits = normalizeDigits(phone);
    if (digits.length >= 8) {
      const rows = await agendaQuery(
        `SELECT id, phone, first_name, last_name, city, source, fee, notes, status_override, created_at
         FROM clients
         WHERE tenant_id = ? AND deleted_at IS NULL
           AND REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '(', '') LIKE ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [config.tenantId, `%${digits}%`]
      );
      client = rows[0] || null;
    }
  }

  if (!client && name) {
    matches = await searchAgendaClients(name, 6);
    client = matches[0] || null;
  }

  if (!client) {
    return { configured: true, source: config.source, client: null, appointments: [], payments: [], matches };
  }

  const [appointments, payments] = await Promise.all([
    agendaQuery(
      `SELECT id, date_time, duration, status, notes, session_number
       FROM appointments
       WHERE tenant_id = ? AND client_id = ?
       ORDER BY date_time DESC
       LIMIT 8`,
      [config.tenantId, client.id]
    ),
    agendaQuery(
      `SELECT id, amount, method, status, confirmed_at, created_at, notes
       FROM payments
       WHERE tenant_id = ? AND client_id = ?
       ORDER BY COALESCE(confirmed_at, created_at) DESC, id DESC
       LIMIT 8`,
      [config.tenantId, client.id]
    ),
  ]);

  return {
    configured: true,
    source: config.source,
    client,
    appointments,
    payments,
    matches,
  };
}

module.exports = {
  resolveAgendaConfig,
  searchAgendaClients,
  getAgendaClientBundle,
};
