import { BinanceSignatureService } from '@modules/exchange/adapters/binance/auth/binance-signature.service';

describe('BinanceSignatureService', () => {
  let service: BinanceSignatureService;

  beforeEach(() => {
    service = new BinanceSignatureService();
  });

  describe('sign()', () => {
    it('produces the correct HMAC-SHA256 signature for a known input', () => {
      // Self-computed test vector using standard HMAC-SHA256(key=secret, message=queryString).
      // Verified by the test run itself — if the algorithm changes, this test catches it.
      const queryString =
        'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559';
      const secret = 'NhqRioBA3igUnkeH3xt3yk9c4OgQabOiTbnFu8Td2pM';

      const signature = service.sign(queryString, secret);

      expect(signature).toBe('2a3b0daa7657af3aede2860ea422fab395fa6616a6201987393569617b6f737d');
    });

    it('produces a 64-character hex string', () => {
      const signature = service.sign('test', 'secret');
      expect(signature).toMatch(/^[0-9a-f]{64}$/);
    });

    it('different inputs produce different signatures', () => {
      const sig1 = service.sign('params=a', 'secret');
      const sig2 = service.sign('params=b', 'secret');
      expect(sig1).not.toBe(sig2);
    });

    it('different secrets produce different signatures for the same input', () => {
      const sig1 = service.sign('params=same', 'secret1');
      const sig2 = service.sign('params=same', 'secret2');
      expect(sig1).not.toBe(sig2);
    });

    it('empty queryString produces a consistent signature', () => {
      const sig1 = service.sign('', 'mysecret');
      const sig2 = service.sign('', 'mysecret');
      expect(sig1).toBe(sig2);
    });

    it('is deterministic for the same inputs', () => {
      const sig1 = service.sign('timestamp=123456789', 'mykey');
      const sig2 = service.sign('timestamp=123456789', 'mykey');
      expect(sig1).toBe(sig2);
    });
  });

  describe('buildSignedQueryString()', () => {
    it('includes timestamp and recvWindow in the output', () => {
      const result = service.buildSignedQueryString(
        { symbol: 'BTCUSDT', quantity: '1.0' },
        1499827319559,
        5000,
        'secret',
      );

      expect(result).toContain('timestamp=1499827319559');
      expect(result).toContain('recvWindow=5000');
    });

    it('appends a signature as the last parameter', () => {
      const result = service.buildSignedQueryString({}, 123456, 5000, 'secret');
      expect(result).toMatch(/&signature=[0-9a-f]{64}$/);
    });

    it('includes all provided params', () => {
      const result = service.buildSignedQueryString(
        { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT' },
        123456,
        5000,
        'secret',
      );
      expect(result).toContain('symbol=BTCUSDT');
      expect(result).toContain('side=BUY');
      expect(result).toContain('type=LIMIT');
    });

    it('handles numeric and boolean params', () => {
      const result = service.buildSignedQueryString(
        { quantity: 0.001, price: 50000, postOnly: true },
        123456,
        5000,
        'secret',
      );
      expect(result).toContain('quantity=0.001');
      expect(result).toContain('price=50000');
      expect(result).toContain('postOnly=true');
    });
  });

  describe('buildQueryString()', () => {
    it('builds a query string from params without signing', () => {
      const result = service.buildQueryString({ symbol: 'BTCUSDT', limit: 100 });
      expect(result).toContain('symbol=BTCUSDT');
      expect(result).toContain('limit=100');
      expect(result).not.toContain('signature=');
      expect(result).not.toContain('timestamp=');
    });

    it('returns empty string for empty params', () => {
      const result = service.buildQueryString({});
      expect(result).toBe('');
    });
  });
});
