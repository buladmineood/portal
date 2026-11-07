import { b64url, b64urlDecode, CLIENT_ASSERTION_TYPE, clientAssertion, randomToken, sha256 } from './crypto.js';

const PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    clientAuth: async (env) => ({ client_secret: env.GOOGLE_CLIENT_SECRET }),
    issuerOk: (c) => c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com',
    identity: (c) => ({
      sub: `google:${c.sub}`,
      provider: 'google',
      email: c.email_verified ? c.email || '' : '',
      name: c.name || '',
      firstName: c.given_name || '',
      lastName: c.family_name || '',
    }),
  },
  microsoft: {
    // "common" приема и служебни, и лични Microsoft акаунти.
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId: (env) => env.MS_CLIENT_ID,
    clientAuth: async (env, nowMs) => ({
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: await clientAssertion(env, PROVIDERS.microsoft.tokenUrl, nowMs),
    }),
    issuerOk: (c) => !!c.tid && c.iss === `https://login.microsoftonline.com/${c.tid}/v2.0`,
    // Идентичността е tid+sub, никога имейл: имейлът в Microsoft акаунт може да се сменя и не е доказателство за притежание.
    identity: (c) => ({
      sub: `microsoft:${c.tid}:${c.sub}`,
      provider: 'microsoft',
      email: c.email || c.preferred_username || '',
      name: c.name || '',
      firstName: c.given_name || '',
      lastName: c.family_name || '',
      tid: c.tid,
      upn: c.preferred_username || '',
    }),
  },
};

export const isProvider = (name) => Object.hasOwn(PROVIDERS, name);

const redirectUri = (env, provider) => `${env.PORTAL_ORIGIN}/api/auth/${provider}/callback`;

export async function beginLogin(env, provider) {
  const p = PROVIDERS[provider];
  const flow = { provider, state: randomToken(), nonce: randomToken(), verifier: randomToken(48) };
  const params = new URLSearchParams({
    client_id: p.clientId(env),
    response_type: 'code',
    redirect_uri: redirectUri(env, provider),
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: b64url(await sha256(flow.verifier)),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { flow, url: `${p.authUrl}?${params}` };
}

function decodeClaims(idToken) {
  const part = String(idToken || '').split('.')[1];
  if (!part) throw new Error('missing id_token');
  return JSON.parse(new TextDecoder().decode(b64urlDecode(part)));
}

// id_token идва директно от token endpoint-а през TLS, затова по OIDC Core 3.1.3.7
// подписът може да не се проверява; всички останали твърдения се проверяват.
export async function completeLogin(env, provider, flow, code, fetchImpl, nowMs = Date.now()) {
  const p = PROVIDERS[provider];
  const res = await fetchImpl(p.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: p.clientId(env),
      ...(await p.clientAuth(env, nowMs)),
      redirect_uri: redirectUri(env, provider),
      code_verifier: flow.verifier,
    }),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  const claims = decodeClaims((await res.json()).id_token);
  const nowSec = nowMs / 1000;
  if (!p.issuerOk(claims)) throw new Error('bad issuer');
  if (claims.aud !== p.clientId(env)) throw new Error('bad audience');
  if (!(claims.exp > nowSec)) throw new Error('expired id_token');
  if (claims.nonce !== flow.nonce) throw new Error('bad nonce');
  if (!claims.sub) throw new Error('missing sub');
  return p.identity(claims);
}
