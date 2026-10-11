import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';

/**
 * BinanceSignatureService generates HMAC-SHA256 request signatures.
 *
 * Binance requires all SIGNED endpoints to include a `signature` parameter
 * computed as HMAC-SHA256(totalParams, secretKey) where:
 *   - For GET/DELETE: totalParams = the query string
 *   - For POST/PUT: totalParams = query string + request body
 *
 * The signature is appended as the LAST parameter in the query string.
 * Modifying any parameter after signing invalidates the signature.
 *
 * Security invariants:
 *  - The secret key is NEVER logged or included in error messages
 *  - The signature is computed in memory only — no intermediate storage
 *  - This service is stateless; the secret is passed at call time (not stored)
 *    so that it can be rotated without restarting the service
 */
@Injectable()
export class BinanceSignatureService {
  /**
   * Signs a query string with the provided secret key.
   *
   * @param queryString - The URL-encoded parameter string to sign.
   *                      Must already contain timestamp and recvWindow.
   * @param secretKey   - The Binance API secret key. Never logged.
   * @returns HMAC-SHA256 hex digest.
   */
  sign(queryString: string, secretKey: string): string {
    return createHmac('sha256', secretKey).update(queryString).digest('hex');
  }

  /**
   * Builds a signed query string by appending timestamp, recvWindow,
   * and signature to the provided parameters.
   *
   * @param params      - Existing key-value pairs (excluding timestamp/signature).
   * @param timestamp   - Server-adjusted timestamp (ms since epoch).
   * @param recvWindowMs - Milliseconds the server should accept the request for.
   * @param secretKey   - The Binance API secret key.
   * @returns Complete signed query string ready for use in the request URL.
   */
  buildSignedQueryString(
    params: Record<string, string | number | boolean>,
    timestamp: number,
    recvWindowMs: number,
    secretKey: string,
  ): string {
    const baseParams = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      timestamp: String(timestamp),
      recvWindow: String(recvWindowMs),
    });

    const queryString = baseParams.toString();
    const signature = this.sign(queryString, secretKey);
    return `${queryString}&signature=${signature}`;
  }

  /**
   * Builds an unsigned query string (for public endpoints).
   */
  buildQueryString(params: Record<string, string | number | boolean>): string {
    const sp = new URLSearchParams(
      Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    );
    return sp.toString();
  }
}
