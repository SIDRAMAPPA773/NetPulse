'use strict';

const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;

function normaliseMethod(method) {
  return String(method || 'GET').toUpperCase() === 'HEAD' ? 'HEAD' : 'GET';
}

function validateTarget(targetUrl) {
  let url;
  try {
    url = new URL(targetUrl);
  } catch {
    return { valid: false, reason: 'Target URL is invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { valid: false, reason: 'Only HTTP and HTTPS targets are supported' };
  }
  if (url.username || url.password) {
    return { valid: false, reason: 'HTTP credentials in target URLs are not permitted' };
  }
  return { valid: true, url };
}

function probeHttp(targetUrl, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs)
    ? Math.max(100, Math.min(options.timeoutMs, 30000))
    : DEFAULT_TIMEOUT_MS;
  const method = normaliseMethod(options.method);
  const maxRedirects = Number.isInteger(options.maxRedirects)
    ? Math.max(0, Math.min(options.maxRedirects, MAX_REDIRECTS))
    : MAX_REDIRECTS;
  const allowedHosts = Array.isArray(options.allowedHosts)
    ? new Set(options.allowedHosts.filter(Boolean).map((host) => String(host).toLowerCase()))
    : null;
  const validation = validateTarget(targetUrl);
  if (!validation.valid) {
    return Promise.resolve({
      targetUrl,
      method,
      status: 'INVALID',
      available: false,
      responseTimeMs: null,
      statusCode: null,
      redirectCount: 0,
      tls: null,
      error: validation.reason,
    });
  }
  if (allowedHosts && !allowedHosts.has(validation.url.hostname.toLowerCase())) {
    return Promise.resolve({
      targetUrl,
      method,
      status: 'UNAUTHORIZED_TARGET',
      available: false,
      responseTimeMs: null,
      statusCode: null,
      redirectCount: 0,
      tls: null,
      error: 'HTTP target host is not approved',
    });
  }

  const request = (url, redirectCount) => new Promise((resolve) => {
    const transport = url.protocol === 'https:' ? https : http;
    const startedAt = process.hrtime.bigint();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        targetUrl,
        method,
        redirectCount,
        responseTimeMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6 * 10) / 10,
        ...result,
      });
    };

    const req = transport.request(url, { method, timeout: timeoutMs }, (res) => {
      const location = res.headers.location;
      res.resume();
      if (location && res.statusCode >= 300 && res.statusCode < 400) {
        if (redirectCount >= maxRedirects) {
          finish({
            status: 'REDIRECT_LIMIT',
            available: false,
            statusCode: res.statusCode,
            tls: null,
            error: 'HTTP redirect limit exceeded',
          });
          return;
        }
        const next = new URL(location, url);
        const nextValidation = validateTarget(next.toString());
        if (!nextValidation.valid || (allowedHosts && !allowedHosts.has(nextValidation.url.hostname.toLowerCase()))) {
          finish({
            status: 'INVALID_REDIRECT',
            available: false,
            statusCode: res.statusCode,
            tls: null,
            error: nextValidation.valid
              ? 'HTTP redirect target is not an approved host'
              : nextValidation.reason,
          });
          return;
        }
        request(nextValidation.url, redirectCount + 1).then(resolve);
        return;
      }

      const certificate = url.protocol === 'https:' && res.socket
        ? res.socket.getPeerCertificate()
        : null;
      const tls = certificate && certificate.valid_to
        ? {
          validTo: certificate.valid_to,
          remainingValidityDays: Math.max(0, Math.ceil(
            (new Date(certificate.valid_to).getTime() - Date.now()) / 86400000,
          )),
          authorized: res.socket.authorized === true,
        }
        : null;
      finish({
        status: 'RESPONDED',
        available: res.statusCode >= 200 && res.statusCode < 400,
        statusCode: res.statusCode,
        tls,
        error: null,
      });
    });
    req.once('timeout', () => {
      req.destroy();
      finish({ status: 'TIMEOUT', available: false, statusCode: null, tls: null, error: 'HTTP request timed out' });
    });
    req.once('error', (error) => {
      finish({
        status: error.code === 'CERT_HAS_EXPIRED' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
          ? 'TLS_ERROR'
          : 'ERROR',
        available: false,
        statusCode: null,
        tls: null,
        error: error.code || error.message,
      });
    });
    req.end();
  });

  return request(validation.url, 0);
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_REDIRECTS,
  validateTarget,
  probeHttp,
};
