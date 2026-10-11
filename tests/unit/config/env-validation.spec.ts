import { envValidationSchema } from '@config/env.validation';

const REQUIRED_BASE: Record<string, string> = {
  NODE_ENV: 'development',
  APP_NAME: 'trading-platform',
  APP_VERSION: '1.0.0',
  API_KEY_SECRET: 'a'.repeat(32),
};

function validate(overrides: Record<string, unknown> = {}) {
  return envValidationSchema.validate({ ...REQUIRED_BASE, ...overrides });
}

describe('envValidationSchema', () => {
  describe('required fields', () => {
    it('passes with all required fields present', () => {
      const { error } = validate();
      expect(error).toBeUndefined();
    });

    it('fails when NODE_ENV is missing', () => {
      const { error } = validate({ NODE_ENV: undefined });
      expect(error).toBeDefined();
      expect(error!.details.some((d) => d.context?.key === 'NODE_ENV')).toBe(true);
    });

    it('fails when APP_NAME is missing', () => {
      const { error } = validate({ APP_NAME: undefined });
      expect(error).toBeDefined();
    });

    it('fails when APP_VERSION is missing', () => {
      const { error } = validate({ APP_VERSION: undefined });
      expect(error).toBeDefined();
    });

    it('fails when API_KEY_SECRET is missing', () => {
      const { error } = validate({ API_KEY_SECRET: undefined });
      expect(error).toBeDefined();
    });
  });

  describe('NODE_ENV', () => {
    it.each(['development', 'test', 'staging', 'production'])('accepts "%s"', (env) => {
      const { error } = validate({ NODE_ENV: env });
      expect(error).toBeUndefined();
    });

    it('rejects unknown environment value', () => {
      const { error } = validate({ NODE_ENV: 'local' });
      expect(error).toBeDefined();
    });
  });

  describe('APP_VERSION', () => {
    it('accepts valid semver', () => {
      const { error } = validate({ APP_VERSION: '2.14.3' });
      expect(error).toBeUndefined();
    });

    it('rejects non-semver string', () => {
      const { error } = validate({ APP_VERSION: 'v1.0.0' });
      expect(error).toBeDefined();
    });

    it('rejects partial semver', () => {
      const { error } = validate({ APP_VERSION: '1.0' });
      expect(error).toBeDefined();
    });
  });

  describe('API_KEY_SECRET', () => {
    it('rejects secrets shorter than 32 chars', () => {
      const { error } = validate({ API_KEY_SECRET: 'short' });
      expect(error).toBeDefined();
    });

    it('accepts exactly 32-char secret', () => {
      const { error } = validate({ API_KEY_SECRET: 'a'.repeat(32) });
      expect(error).toBeUndefined();
    });
  });

  describe('defaults', () => {
    it('applies default APP_PORT = 3000', () => {
      const { value } = validate();
      expect(value.APP_PORT).toBe(3000);
    });

    it('applies default LOG_LEVEL = info', () => {
      const { value } = validate();
      expect(value.LOG_LEVEL).toBe('info');
    });

    it('applies default SECRETS_PROVIDER = env', () => {
      const { value } = validate();
      expect(value.SECRETS_PROVIDER).toBe('env');
    });

    it('applies default RISK_ENABLED = true', () => {
      const { value } = validate();
      expect(value.RISK_ENABLED).toBe(true);
    });

    it('applies default PAPER_TRADING_ENABLED = false', () => {
      const { value } = validate();
      expect(value.PAPER_TRADING_ENABLED).toBe(false);
    });

    it('applies default ALERTS_ENABLED = true', () => {
      const { value } = validate();
      expect(value.ALERTS_ENABLED).toBe(true);
    });
  });

  describe('LOG_LEVEL', () => {
    it.each(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'])(
      'accepts "%s"',
      (level) => {
        const { error } = validate({ LOG_LEVEL: level });
        expect(error).toBeUndefined();
      },
    );

    it('rejects unknown log level', () => {
      const { error } = validate({ LOG_LEVEL: 'trace' });
      expect(error).toBeDefined();
    });
  });

  describe('SECRETS_PROVIDER', () => {
    it('accepts "env"', () => {
      const { error } = validate({ SECRETS_PROVIDER: 'env' });
      expect(error).toBeUndefined();
    });

    it('accepts "docker"', () => {
      const { error } = validate({ SECRETS_PROVIDER: 'docker' });
      expect(error).toBeUndefined();
    });

    it('rejects unknown provider', () => {
      const { error } = validate({ SECRETS_PROVIDER: 'vault' });
      expect(error).toBeDefined();
    });
  });

  describe('risk management constraints', () => {
    it('rejects zero max position size', () => {
      const { error } = validate({ RISK_MAX_POSITION_SIZE_USD: 0 });
      expect(error).toBeDefined();
    });

    it('rejects leverage below 1', () => {
      const { error } = validate({ RISK_MAX_LEVERAGE: 0 });
      expect(error).toBeDefined();
    });

    it('rejects drawdown above 100%', () => {
      const { error } = validate({ RISK_MAX_DRAWDOWN_PERCENT: 101 });
      expect(error).toBeDefined();
    });
  });

  describe('execution constraints', () => {
    it('accepts valid routing modes', () => {
      for (const mode of ['direct', 'smart', 'vwap']) {
        const { error } = validate({ EXECUTION_ORDER_ROUTING_MODE: mode });
        expect(error).toBeUndefined();
      }
    });

    it('rejects unknown routing mode', () => {
      const { error } = validate({ EXECUTION_ORDER_ROUTING_MODE: 'manual' });
      expect(error).toBeDefined();
    });
  });

  describe('abortEarly: false — surfaces all errors', () => {
    it('returns multiple validation errors in one pass', () => {
      const { error } = validate({
        NODE_ENV: 'bad-env',
        APP_VERSION: 'not-semver',
        API_KEY_SECRET: 'short',
      });
      expect(error).toBeDefined();
      expect(error!.details.length).toBeGreaterThan(1);
    });
  });
});
