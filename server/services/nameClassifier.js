function classifyName(waName) {
  if (!waName || typeof waName !== 'string') {
    return { quality: 'sin_nombre', cleanName: null };
  }

  const trimmed = waName.trim();

  const emojiOnly = /^[\p{Emoji}\p{Emoji_Component}\s]+$/u;
  if (emojiOnly.test(trimmed)) {
    return { quality: 'sin_nombre', cleanName: null };
  }

  if (trimmed.length <= 2) {
    return { quality: 'sin_nombre', cleanName: null };
  }

  if (trimmed.includes('@')) {
    return { quality: 'sin_nombre', cleanName: null };
  }

  if (/^[a-z0-9_]+$/i.test(trimmed) && /\d/.test(trimmed)) {
    return { quality: 'sin_nombre', cleanName: null };
  }

  if (/^[^\p{L}\d]+$/u.test(trimmed)) {
    return { quality: 'sin_nombre', cleanName: null };
  }

  const cleaned = trimmed
    .replace(/[\p{Emoji}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length <= 1) {
    return { quality: 'sin_nombre', cleanName: null };
  }

  const businessWords = /\b(importadora|registro|agente|lic\.|dr\.|dra\.|ing\.|s\.r\.l|s\.a\.|ltda)\b/i;
  const words = cleaned.split(' ').filter((word) => word.length > 0);

  if (words.length >= 2 || businessWords.test(cleaned)) {
    return { quality: 'nombre_completo', cleanName: cleaned };
  }

  return { quality: 'nombre_parcial', cleanName: cleaned };
}

module.exports = { classifyName };
