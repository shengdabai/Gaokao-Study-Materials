export const MAX_BODY_BYTES = 8 * 1024 * 1024;

export function parseJsonObject(value) {
  try {
    if (typeof value === 'string') {
      if (Buffer.byteLength(value) > MAX_BODY_BYTES) return null;
      value = JSON.parse(value);
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
