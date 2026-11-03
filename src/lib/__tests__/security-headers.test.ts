// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { canonicalLocation, cspDirectives, fallbackCsp, isProductionHost, securityMiddleware } from '../../../scripts/security-headers.mjs';

function run(host = 'localhost:4173', target = '/', existing: Record<string, string> = {}, forwarded?: string) {
  const request = new IncomingMessage(new Socket());
  request.headers.host = host;
  if (forwarded) request.headers['x-forwarded-host'] = forwarded;
  request.url = target;
  const response = new ServerResponse(request);
  for (const [key, value] of Object.entries(existing)) response.setHeader(key, value);
  const next = vi.fn();
  securityMiddleware(request, response, next);
  return { request, response, next };
}

describe('security headers', () => {
  it('sets defaults without touching the staging gateway or caching', () => {
    const existing = {
      'strict-transport-security': 'max-age=86400',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
      'content-security-policy': "default-src 'none'",
      'referrer-policy': 'no-referrer'
    };
    const { response, next } = run('bc-daylight.staging.adamstuckert.com', '/version', existing);
    expect(next).toHaveBeenCalledOnce();
    for (const [name, value] of Object.entries(existing)) expect(response.getHeader(name)).toBe(value);
    expect(response.getHeader('x-content-type-options')).toBe('nosniff');
    expect(response.getHeader('x-frame-options')).toBe('DENY');
    expect(response.getHeader('permissions-policy')).toContain('geolocation=()');
    expect(response.getHeader('location')).toBeUndefined();
  });

  it('leaves response-specific CSP replaceable and static caching untouched', () => {
    const { response } = run();
    expect(response.getHeader('content-security-policy')).toBe(fallbackCsp);
    expect(response.getHeader('cache-control')).toBeUndefined();
    response.setHeader('content-security-policy', "script-src 'nonce-generated-by-kit'");
    response.setHeader('cache-control', 'public,max-age=31536000,immutable');
    expect(response.getHeader('content-security-policy')).toBe("script-src 'nonce-generated-by-kit'");
    expect(response.getHeader('cache-control')).toContain('immutable');
  });

  it('enforces production HSTS without committing unaudited subdomains', () => {
    for (const host of ['bcdaylight.ca', 'www.bcdaylight.ca', 'BCDAYLIGHT.CA', 'bcdaylight.ca:443']) {
      expect(isProductionHost(host)).toBe(true);
      const { response } = run(host);
      expect(response.getHeader('strict-transport-security')).toBe('max-age=31536000');
      expect(String(response.getHeader('strict-transport-security'))).not.toMatch(/includeSubDomains|preload/i);
    }
    expect(run('bcdaylight.ca', '/', { 'strict-transport-security': 'max-age=63072000' }).response.getHeader('strict-transport-security')).toBe('max-age=63072000');
  });

  it.each([
    'localhost:4173', '127.0.0.1:4173', 'bc-daylight.staging.adamstuckert.com',
    'bcdaylight-staging.fly.dev', 'vancouver-pdt.fly.dev', 'bcdaylight.ca.evil.example',
    'www.bcdaylight.ca.evil.example', 'evil@www.bcdaylight.ca', 'www.bcdaylight.ca:4173',
    'www.bcdaylight.ca,evil.example', ''
  ])('does not redirect or apply production HSTS on %s', (host) => {
    const { response, next } = run(host, '/version?q=1', {}, 'www.bcdaylight.ca');
    expect(isProductionHost(host)).toBe(false);
    expect(next).toHaveBeenCalledOnce();
    expect(response.getHeader('location')).toBeUndefined();
    expect(response.getHeader('strict-transport-security')).toBeUndefined();
  });

  it('uses a permanent method-preserving www redirect, including static paths', () => {
    for (const path of ['/', '/version?from=www&x=two%20words', '/og.png?size=1', '/a%2Fb?x=%2F&x=2']) {
      const { response, next } = run('WWW.BCDAYLIGHT.CA:443', path);
      expect(next).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(308);
      expect(response.getHeader('location')).toBe(`https://bcdaylight.ca${path}`);
      expect(response.writableEnded).toBe(true);
    }
    expect(run('bcdaylight.ca', '/version').next).toHaveBeenCalledOnce();
  });

  it('cannot turn a request-target into an external redirect', () => {
    for (const target of ['//evil.example/path?x=1', '/\\evil.example/path', '/%2f%2fevil.example']) {
      const location = canonicalLocation('www.bcdaylight.ca', target)!;
      expect(new URL(location).origin).toBe('https://bcdaylight.ca');
    }
    for (const target of ['https://evil.example/', '/\r\nlocation: https://evil.example', undefined]) {
      expect(canonicalLocation('www.bcdaylight.ca', target)).toBeNull();
    }
  });

  it('allows required assets/styles but no arbitrary scripts, handlers or eval', () => {
    expect(cspDirectives?.['script-src']).toEqual(['self']);
    expect(cspDirectives?.['script-src-attr']).toEqual(['none']);
    expect(cspDirectives?.['style-src']).toEqual(['self', 'unsafe-inline', 'https://fonts.googleapis.com']);
    expect(cspDirectives?.['font-src']).toEqual(['self', 'https://fonts.gstatic.com']);
    for (const key of ['object-src', 'base-uri', 'frame-ancestors'] as const) {
      expect(cspDirectives?.[key]).toEqual(['none']);
    }
    expect(JSON.stringify(cspDirectives)).not.toContain('unsafe-eval');
  });
});
