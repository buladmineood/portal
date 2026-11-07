const enc = new TextEncoder();

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// Без 0/O/1/I/L, за да се диктува лесно по телефона.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function randomCode(length = 8) {
  // 248 е най-голямото кратно на 31 под 256; по-големите стойности се отхвърлят, за да няма отклонение.
  const out = [];
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < 248 && out.length < length) out.push(ALPHABET[b % 31]);
    }
  }
  return out.join('');
}

export async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(payload, secret, ttlSeconds, nowMs = Date.now()) {
  const body = b64url(enc.encode(JSON.stringify({ ...payload, exp: Math.floor(nowMs / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyToken(token, secret, nowMs = Date.now()) {
  if (typeof token !== 'string') return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecode(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    return payload.exp > nowMs / 1000 ? payload : null;
  } catch {
    return null;
  }
}

// Cloudflare Workers позволява най-много 100 000 итерации за PBKDF2. Затова паролата първо минава
// през HMAC с отделна тайна (pepper), пазена в Cloudflare: откраднат списък с хешове от SharePoint
// не може да се разбива без нея. Броят итерации е в самия хеш, за да може да се вдигне по-късно.
const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password, salt, iterations, pepper) {
  const peppered = await crypto.subtle.sign('HMAC', await hmacKey(pepper), enc.encode(password));
  const key = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return b64url(new Uint8Array(bits));
}

export async function hashPassword(password, pepper) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS, pepper);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64url(salt)}$${hash}`;
}

// Без съхранен хеш се смята фиктивен, за да не издава времето за отговор дали акаунтът съществува.
export async function verifyPassword(password, stored, pepper) {
  const [scheme, iterations, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2-sha256' || !hash) {
    await pbkdf2(password, new Uint8Array(16), PBKDF2_ITERATIONS, pepper);
    return false;
  }
  return safeEqual(await pbkdf2(password, b64urlDecode(salt), Number(iterations), pepper), hash);
}

// Удостоверяване пред Microsoft със сертификат, защото клиентските тайни са блокирани в tenant-а.
// https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials
export const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

export async function clientAssertion(env, audience, nowMs = Date.now()) {
  const der = Uint8Array.from(atob(env.MS_CERT_PRIVATE_KEY), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(nowMs / 1000);
  const encode = (value) => b64url(enc.encode(JSON.stringify(value)));
  const unsigned = [
    encode({ alg: 'PS256', typ: 'JWT', 'x5t#S256': env.MS_CERT_THUMBPRINT }),
    encode({
      aud: audience,
      iss: env.MS_CLIENT_ID,
      sub: env.MS_CLIENT_ID,
      jti: crypto.randomUUID(),
      iat: now,
      nbf: now,
      exp: now + 300,
    }),
  ].join('.');
  const signature = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 32 }, key, enc.encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
