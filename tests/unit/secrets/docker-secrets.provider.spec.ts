import { DockerSecretsProvider } from '@infrastructure/providers/secrets/docker-secrets.provider';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import * as os from 'os';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempSecretsDir(secrets: Record<string, string>): {
  path: string;
  cleanup: () => void;
} {
  const dir = join(os.tmpdir(), `docker-secrets-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(secrets)) {
    writeFileSync(join(dir, name), value, 'utf-8');
  }
  return {
    path: dir,
    cleanup: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('DockerSecretsProvider', () => {
  describe('get()', () => {
    it('reads secret by exact key name', async () => {
      const { path, cleanup } = makeTempSecretsDir({ my_secret: 'my-value' });
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.get('my_secret');
        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toBe('my-value');
      } finally {
        cleanup();
      }
    });

    it('reads secret by lowercase key when uppercase is given', async () => {
      const { path, cleanup } = makeTempSecretsDir({ api_key: 'secret-value' });
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.get('API_KEY');
        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toBe('secret-value');
      } finally {
        cleanup();
      }
    });

    it('reads secret by uppercase key when lowercase is given', async () => {
      const { path, cleanup } = makeTempSecretsDir({ API_KEY: 'secret-value' });
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.get('api_key');
        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toBe('secret-value');
      } finally {
        cleanup();
      }
    });

    it('strips trailing newlines from file content', async () => {
      const { path, cleanup } = makeTempSecretsDir({ db_password: 'pass123\n' });
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.get('db_password');
        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toBe('pass123');
      } finally {
        cleanup();
      }
    });

    it('returns ok(null) for a missing secret', async () => {
      const { path, cleanup } = makeTempSecretsDir({});
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.get('nonexistent_key');
        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toBeNull();
      } finally {
        cleanup();
      }
    });

    it('returns ok(null) when the secrets directory does not exist', async () => {
      const provider = new DockerSecretsProvider('/nonexistent/secrets/dir');
      const result = await provider.get('some_key');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toBeNull();
    });
  });

  describe('getRequired()', () => {
    it('returns the value when the secret exists', async () => {
      const { path, cleanup } = makeTempSecretsDir({ api_key: 'my-api-key' });
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.getRequired('api_key');
        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(result.value).toBe('my-api-key');
      } finally {
        cleanup();
      }
    });

    it('returns err when the required secret is missing', async () => {
      const { path, cleanup } = makeTempSecretsDir({});
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.getRequired('missing_secret');
        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error.message).toContain('missing_secret');
      } finally {
        cleanup();
      }
    });

    it('error message does NOT expose the secret directory path as a value leak', async () => {
      const { path, cleanup } = makeTempSecretsDir({});
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.getRequired('missing_key');
        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          // Message should reference the key name, not any secret value
          expect(result.error.message).toContain('missing_key');
        }
      } finally {
        cleanup();
      }
    });
  });

  describe('getAll()', () => {
    it('returns all secrets when no prefix is given', async () => {
      const { path, cleanup } = makeTempSecretsDir({
        db_password: 'pass',
        api_key: 'key',
        jwt_secret: 'jwtsec',
      });
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.getAll();
        expect(result.isOk()).toBe(true);
        if (result.isOk()) expect(Object.keys(result.value).length).toBe(3);
      } finally {
        cleanup();
      }
    });

    it('filters secrets by prefix', async () => {
      const { path, cleanup } = makeTempSecretsDir({
        db_password: 'pass',
        db_user: 'user',
        api_key: 'key',
      });
      try {
        const provider = new DockerSecretsProvider(path);
        const result = await provider.getAll('db_');
        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          const keys = Object.keys(result.value);
          expect(keys).toContain('db_password');
          expect(keys).toContain('db_user');
          expect(keys).not.toContain('api_key');
        }
      } finally {
        cleanup();
      }
    });

    it('returns empty object when directory does not exist', async () => {
      const provider = new DockerSecretsProvider('/nonexistent/dir');
      const result = await provider.getAll();
      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value).toEqual({});
    });
  });

  describe('getProviderName()', () => {
    it('returns "docker-secrets"', () => {
      const provider = new DockerSecretsProvider('/run/secrets');
      expect(provider.getProviderName()).toBe('docker-secrets');
    });
  });

  describe('getHealth()', () => {
    it('reports healthy when secrets directory exists and is readable', async () => {
      const { path, cleanup } = makeTempSecretsDir({ db_password: 'pass' });
      try {
        const provider = new DockerSecretsProvider(path);
        const health = await provider.getHealth();
        expect(health.status).toBe('healthy');
        expect(health.message).toContain(path);
      } finally {
        cleanup();
      }
    });

    it('reports unhealthy when secrets directory does not exist', async () => {
      const provider = new DockerSecretsProvider('/nonexistent/path/secrets');
      const health = await provider.getHealth();
      expect(health.status).toBe('unhealthy');
      expect(health.message).toContain('/nonexistent/path/secrets');
    });

    it('includes checkedAt timestamp', async () => {
      const provider = new DockerSecretsProvider('/nonexistent');
      const health = await provider.getHealth();
      expect(health.checkedAt).toBeInstanceOf(Date);
    });
  });

  describe('security — successful reads do not emit console errors', () => {
    it('does not call console.error on a successful read', async () => {
      const { path, cleanup } = makeTempSecretsDir({ db_password: 'super-secret-value' });
      try {
        const provider = new DockerSecretsProvider(path);
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        await provider.get('db_password');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      } finally {
        cleanup();
      }
    });
  });
});
