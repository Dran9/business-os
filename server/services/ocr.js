/**
 * OCR de comprobantes bolivianos para Business OS.
 * Adaptado del flujo operativo usado en agenda4.0.
 */

async function extractReceiptData(fileBuffer, mimeType = 'image/jpeg', options = {}) {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) {
    console.warn('[ocr] GOOGLE_VISION_API_KEY no configurado');
    return null;
  }

  const text = mimeType === 'application/pdf'
    ? await extractPdfText(fileBuffer, apiKey)
    : await extractImageText(fileBuffer, apiKey);

  if (!text) return null;
  return parseBolivianReceipt(text, options);
}

async function extractImageText(fileBuffer, apiKey) {
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: fileBuffer.toString('base64') },
        features: [{ type: 'TEXT_DETECTION' }],
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Vision image error: ${text}`);
  }

  const data = await res.json();
  return data.responses?.[0]?.fullTextAnnotation?.text || '';
}

async function extractPdfText(fileBuffer, apiKey) {
  const res = await fetch(`https://vision.googleapis.com/v1/files:annotate?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        inputConfig: {
          content: fileBuffer.toString('base64'),
          mimeType: 'application/pdf',
        },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Vision PDF error: ${text}`);
  }

  const data = await res.json();
  const pages = data.responses?.[0]?.responses || [];
  return pages.map((page) => page.fullTextAnnotation?.text || '').join('\n');
}

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function parseBolivianReceipt(text, options = {}) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const fullText = lines.join('\n');
  const validDestinationAccounts = new Set(
    (options.validDestinationAccounts || [])
      .map((item) => normalizeDigits(item))
      .filter(Boolean)
  );

  let amount = null;
  const amountPatterns = [
    /(?:Bs\.?|BOB)\s*[:.]?\s*([\d.,]+)/i,
    /Monto[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
    /Importe[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
    /Total[:\s]*(?:Bs\.?)?\s*([\d.,]+)/i,
    /La\s+suma\s+de\s+Bs\.?[:\s]*([\d.,]+)/i,
  ];
  for (const pattern of amountPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      amount = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }

  let date = null;
  const datePatterns = [
    /(\d{2}\/\d{2}\/\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{2}-\d{2}-\d{4})/,
    /(\d{1,2}\s+de\s+\w+,?\s*\d{4})/i,
  ];
  for (const pattern of datePatterns) {
    const match = fullText.match(pattern);
    if (match) {
      date = match[1];
      break;
    }
  }

  let time = null;
  const timePatterns = [
    /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?)/i,
    /Hora[:\s]*(\d{1,2}:\d{2}(?::\d{2})?)/i,
  ];
  for (const pattern of timePatterns) {
    const match = fullText.match(pattern);
    if (match?.[1]) {
      time = match[1].trim();
      break;
    }
  }

  let name = null;
  const senderPatterns = [
    /^De[:\s]+([^\n]+)/im,
    /Enviado por[:\s]+([^\n]+)/i,
  ];
  for (const pattern of senderPatterns) {
    const match = fullText.match(pattern);
    if (match?.[1]) {
      name = match[1].trim();
      break;
    }
  }

  let reference = null;
  const referencePatterns = [
    /(?:Referencia|Nro\.?\s*de\s*operaci[oó]n|N[uú]mero\s*de\s*comprobante)[:\s]*([^\n]+)/i,
    /Bancarizaci[oó]n[:\s]*([^\n]+)/i,
  ];
  for (const pattern of referencePatterns) {
    const match = fullText.match(pattern);
    if (match?.[1]) {
      reference = match[1].trim();
      break;
    }
  }

  let bank = null;
  if (/mercantil/i.test(fullText)) bank = 'Mercantil';
  else if (/bisa/i.test(fullText)) bank = 'BISA';
  else if (/bcp/i.test(fullText)) bank = 'BCP';
  else if (/bnb/i.test(fullText)) bank = 'BNB';
  else if (/ganadero/i.test(fullText)) bank = 'Ganadero';
  else if (/sol/i.test(fullText)) bank = 'BancoSol';

  const candidates = new Set();
  for (const line of lines) {
    const inlineMatches = line.match(/\d[\d\s.-]{7,}\d/g) || [];
    for (const match of inlineMatches) {
      const normalized = normalizeDigits(match);
      if (normalized.length >= 8) candidates.add(normalized);
    }
  }

  let destAccount = null;
  for (const candidate of candidates) {
    if (validDestinationAccounts.has(candidate)) {
      destAccount = candidate;
      break;
    }
  }

  let destName = null;
  const destNamePatterns = [
    /Nombre\s+del\s+destinatario[:\s]*([^\n]+)/i,
    /A nombre de[:\s]*([^\n]+)/i,
    /Para[:\s]*([^\n]+)/i,
  ];
  for (const pattern of destNamePatterns) {
    const match = fullText.match(pattern);
    if (match?.[1]) {
      destName = match[1].trim().replace(/^:\s*/, '');
      break;
    }
  }

  return {
    name,
    amount: Number.isFinite(amount) ? Math.round(amount) : null,
    date,
    time,
    reference,
    bank,
    destName,
    destAccount,
    destVerified: !!destAccount,
    destAccountVerified: !!destAccount,
    raw_text: fullText,
  };
}

module.exports = { extractReceiptData };
