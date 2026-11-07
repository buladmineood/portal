// Разрешени са само обичайни документи и снимки. Видът се определя по съдържанието на файла,
// а не по името или по заявения от браузъра тип, за да не може да се качи HTML или програма.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_DOCUMENT = 10;
export const ALLOWED_LABEL = 'PDF, JPG, PNG, HEIC или DOCX';

const startsWith = (bytes, signature, offset = 0) => signature.every((b, i) => bytes[offset + i] === b);
const ascii = (bytes, from, to) => String.fromCharCode(...bytes.slice(from, to));

export function detectFileType(bytes, fileName) {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: 'pdf', mime: 'application/pdf' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' };
  if (ascii(bytes, 4, 8) === 'ftyp' && ['heic', 'heix', 'heif', 'mif1', 'msf1'].includes(ascii(bytes, 8, 12))) {
    return { ext: 'heic', mime: 'image/heic' };
  }
  // DOCX е ZIP архив; приема се само с разширение .docx и със съдържанието на Word документ.
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && /\.docx$/i.test(fileName)) {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 64 * 1024)));
    if (head.includes('[Content_Types].xml') || head.includes('word/')) {
      return { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    }
  }
  return null;
}

// Името се показва на хората, но не се ползва за пътя във файловото хранилище.
export function cleanFileName(raw, ext) {
  let name = '';
  try { name = decodeURIComponent(raw || ''); } catch { name = ''; }
  name = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!name) name = `документ.${ext}`;
  if (!name.toLowerCase().endsWith(`.${ext}`) && !(ext === 'jpg' && /\.jpe?g$/i.test(name))) name = `${name}.${ext}`;
  return name;
}

// Заглавие за изтегляне: ASCII резервно име плюс пълното име по RFC 5987.
export function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
