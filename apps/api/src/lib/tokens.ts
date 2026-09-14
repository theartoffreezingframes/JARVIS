import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../env.js';

/**
 * Minimal, dependency-free HS256 JWT implementation.
 *
 * Only the algorithms we actually use are supported (no `alg: none`, no RS/HS
 * confusion), and every claim is validated on verify.
 */

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  typ: 'access';
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return createHmac('sha256', config.jwtSecret).update(data).digest('base64url');
}

export function signAccessToken(payload: Omit<AccessTokenClaims, 'iat' | 'exp' | 'typ'>, ttlSeconds = config.accessTokenTtlSeconds): string {
  const iat = Math.floor(Date.now() / 1000);
  const claims: AccessTokenClaims = { ...payload, typ: 'access', iat, exp: iat + ttlSeconds };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(claims));
  const signature = sign(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];

  const expected = sign(`${header}.${body}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as { alg?: string };
    if (parsedHeader.alg !== 'HS256') return null;

    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<AccessTokenClaims>;
    if (claims.typ !== 'access') return null;
    if (typeof claims.sub !== 'string' || !claims.sub) return null;
    if (typeof claims.sid !== 'string' || !claims.sid) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null;
    if (typeof claims.iat !== 'number' || claims.iat * 1000 > Date.now() + 60_000) return null;
    return claims as AccessTokenClaims;
  } catch {
    return null;
  }
}

export const accessTokenExpiry = (): number => Date.now() + config.accessTokenTtlSeconds * 1000;
