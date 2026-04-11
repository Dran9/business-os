const { query } = require('../db');
const { extractPdfText } = require('./ocr');

const MAX_TEXT_CHARS = 32000;
const ALLOWED_TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
]);

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateText(value, maxChars = MAX_TEXT_CHARS) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}\n…`;
}

function buildExcerpt(value, maxChars = 220) {
  const normalized = normalizeWhitespace(value).replace(/\n/g, ' ');
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function isSupportedTextMimeType(mimeType) {
  return ALLOWED_TEXT_MIME_TYPES.has(String(mimeType || '').toLowerCase());
}

async function extractAiDocumentText(file) {
  if (!file?.buffer || !file?.mimetype) {
    throw new Error('Archivo inválido');
  }

  const mimeType = String(file.mimetype || '').toLowerCase();

  if (isSupportedTextMimeType(mimeType)) {
    return truncateText(file.buffer.toString('utf8'));
  }

  if (mimeType === 'application/pdf') {
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      throw new Error('Falta GOOGLE_VISION_API_KEY para leer PDFs');
    }
    const pdfText = await extractPdfText(file.buffer, apiKey);
    return truncateText(pdfText);
  }

  throw new Error('Formato no soportado. Usa TXT, MD, CSV, JSON, HTML, XML o PDF');
}

async function listAiContextDocuments(tenantId) {
  const rows = await query(
    `SELECT id, filename, mime_type, char_count, active, created_by, created_at, updated_at,
            LEFT(extracted_text, 280) AS excerpt
     FROM ai_context_documents
     WHERE tenant_id = ?
     ORDER BY active DESC, updated_at DESC, id DESC`,
    [tenantId]
  );

  return rows.map((row) => ({
    ...row,
    active: row.active === true || row.active === 1,
    char_count: Number(row.char_count || 0),
    excerpt: buildExcerpt(row.excerpt || ''),
  }));
}

async function createAiContextDocument(tenantId, file, createdBy = null) {
  const extractedText = await extractAiDocumentText(file);
  if (!extractedText) {
    throw new Error('No se pudo extraer texto utilizable del archivo');
  }

  const result = await query(
    `INSERT INTO ai_context_documents (
      tenant_id, filename, mime_type, extracted_text, char_count, active, created_by
    ) VALUES (?, ?, ?, ?, ?, TRUE, ?)`,
    [
      tenantId,
      String(file.originalname || 'documento').slice(0, 255),
      String(file.mimetype || 'application/octet-stream').slice(0, 120),
      extractedText,
      extractedText.length,
      createdBy ? String(createdBy).slice(0, 100) : null,
    ]
  );

  const documents = await listAiContextDocuments(tenantId);
  return documents.find((item) => Number(item.id) === Number(result.insertId)) || null;
}

async function updateAiContextDocument(tenantId, documentId, patch = {}) {
  const rows = await query(
    'SELECT id FROM ai_context_documents WHERE id = ? AND tenant_id = ? LIMIT 1',
    [documentId, tenantId]
  );

  if (!rows[0]) {
    throw new Error('Documento no encontrado');
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'active')) {
    await query(
      'UPDATE ai_context_documents SET active = ? WHERE id = ? AND tenant_id = ?',
      [patch.active === true, documentId, tenantId]
    );
  }

  const documents = await listAiContextDocuments(tenantId);
  return documents.find((item) => Number(item.id) === Number(documentId)) || null;
}

async function deleteAiContextDocument(tenantId, documentId) {
  await query(
    'DELETE FROM ai_context_documents WHERE id = ? AND tenant_id = ?',
    [documentId, tenantId]
  );
}

async function getActiveAiDocumentsContext(tenantId, maxChars = 12000) {
  const rows = await query(
    `SELECT filename, extracted_text
     FROM ai_context_documents
     WHERE tenant_id = ? AND active = TRUE
     ORDER BY updated_at DESC, id DESC`,
    [tenantId]
  );

  if (!rows.length) return '';

  const sections = [];
  let used = 0;

  for (const row of rows) {
    const filename = String(row.filename || 'documento');
    const text = normalizeWhitespace(row.extracted_text || '');
    if (!text) continue;

    const remaining = maxChars - used;
    if (remaining <= 0) break;

    const snippet = text.slice(0, remaining);
    sections.push(`Documento "${filename}":\n${snippet}`);
    used += snippet.length;
  }

  return sections.join('\n\n');
}

module.exports = {
  createAiContextDocument,
  deleteAiContextDocument,
  getActiveAiDocumentsContext,
  listAiContextDocuments,
  updateAiContextDocument,
};
