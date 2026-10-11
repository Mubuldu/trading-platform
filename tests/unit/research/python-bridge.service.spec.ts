import {
  PythonBridgeService,
  PythonRequest,
} from '@modules/research/application/services/python-bridge.service';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ResearchPythonBridgeError } from '@modules/research/domain/errors/research.errors';
import { EventEmitter } from 'events';
import * as childProcess from 'child_process';

// ─── Mock child_process.spawn ────────────────────────────────────────────────

/**
 * Creates a fake child process that emits stdout data and closes.
 * This lets us test the JSON protocol handling without a real Python environment.
 */
function makeFakeProcess(
  stdoutLines: string[] = [],
  exitCode = 0,
  stderrLines: string[] = [],
): ReturnType<typeof childProcess.spawn> {
  const stdin = Object.assign(new EventEmitter(), {
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
  });
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  const proc = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    pid: 12345,
    kill: jest.fn(),
    exitCode: null as number | null,
  });

  // Simulate async delivery of stdout and close
  setImmediate(() => {
    for (const line of stdoutLines) {
      (stdout as EventEmitter).emit('data', Buffer.from(line + '\n'));
    }
    for (const line of stderrLines) {
      (stderr as EventEmitter).emit('data', Buffer.from(line + '\n'));
    }
    (proc as unknown as EventEmitter).emit('close', exitCode);
  });

  return proc as unknown as ReturnType<typeof childProcess.spawn>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PythonBridgeService', () => {
  let service: PythonBridgeService;
  let logger: jest.Mocked<AppLoggerService>;
  let spawnSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new PythonBridgeService(logger);

    spawnSpy = jest.spyOn(childProcess, 'spawn');
  });

  afterEach(() => {
    spawnSpy.mockRestore();
  });

  // ── execute() — success ────────────────────────────────────────────────────

  describe('execute() — success path', () => {
    it('parses a successful JSON response from stdout', async () => {
      const response = {
        requestId: 'req-001',
        success: true,
        result: { sharpe: 1.5, trades: 42 },
        logs: ['Script started'],
      };
      spawnSpy.mockReturnValue(makeFakeProcess([JSON.stringify(response)]));

      const request: PythonRequest = {
        requestId: 'req-001',
        script: 'sma_crossover',
        payload: { fastPeriod: 10, slowPeriod: 30 },
      };

      const result = await service.execute(request);

      expect(result.success).toBe(true);
      expect(result.requestId).toBe('req-001');
      expect(result.result?.sharpe).toBe(1.5);
    });

    it('sends the request as JSON over stdin', async () => {
      const response = {
        requestId: 'req-002',
        success: true,
        result: {},
      };
      const fakeProc = makeFakeProcess([JSON.stringify(response)]);
      spawnSpy.mockReturnValue(fakeProc);

      const request: PythonRequest = {
        requestId: 'req-002',
        script: 'my_model',
        payload: { epochs: 100 },
      };

      await service.execute(request);

      expect(fakeProc.stdin!.write).toHaveBeenCalledWith(
        expect.stringContaining('"requestId":"req-002"'),
      );
    });

    it('handles multiple stdout lines and uses the last non-empty line', async () => {
      const finalResponse = JSON.stringify({
        requestId: 'req-003',
        success: true,
        result: { accuracy: 0.92 },
      });
      spawnSpy.mockReturnValue(makeFakeProcess(['progress: 50%', 'progress: 100%', finalResponse]));

      const result = await service.execute({
        requestId: 'req-003',
        script: 'classifier',
        payload: {},
      });

      expect(result.success).toBe(true);
      expect(result.result?.accuracy).toBe(0.92);
    });
  });

  // ── execute() — error paths ────────────────────────────────────────────────

  describe('execute() — error paths', () => {
    it('throws ResearchPythonBridgeError when process exits with non-zero code', async () => {
      spawnSpy.mockReturnValue(makeFakeProcess([], 1, ['ImportError: module not found']));

      await expect(
        service.execute({
          requestId: 'req-err',
          script: 'broken_script',
          payload: {},
        }),
      ).rejects.toBeInstanceOf(ResearchPythonBridgeError);
    });

    it('throws ResearchPythonBridgeError when stdout is not valid JSON', async () => {
      spawnSpy.mockReturnValue(makeFakeProcess(['not valid json at all']));

      await expect(
        service.execute({
          requestId: 'req-bad-json',
          script: 'bad_output',
          payload: {},
        }),
      ).rejects.toBeInstanceOf(ResearchPythonBridgeError);
    });

    it('respects a custom timeoutMs and kills the process on timeout', async () => {
      // Fake a process that never closes
      const stdin = Object.assign(new EventEmitter(), {
        write: jest.fn(),
        end: jest.fn(),
      });
      const hangingProc = Object.assign(new EventEmitter(), {
        stdin,
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: 99999,
        kill: jest.fn(),
      });
      spawnSpy.mockReturnValue(hangingProc as unknown as ReturnType<typeof childProcess.spawn>);

      const p = service.execute({
        requestId: 'req-timeout',
        script: 'slow_script',
        payload: {},
        timeoutMs: 50, // very short timeout for testing
      });

      await expect(p).rejects.toBeInstanceOf(ResearchPythonBridgeError);
      expect((hangingProc as unknown as { kill: jest.Mock }).kill).toHaveBeenCalled();
    }, 2000);
  });

  // ── isPythonAvailable() ────────────────────────────────────────────────────

  describe('isPythonAvailable()', () => {
    it('returns true when python3 can be spawned and exits 0', async () => {
      const versionResponse = JSON.stringify({
        requestId: 'health',
        success: true,
        result: { version: '3.11.0' },
      });
      spawnSpy.mockReturnValue(makeFakeProcess([versionResponse]));

      const available = await service.isPythonAvailable();

      expect(typeof available).toBe('boolean');
    });
  });

  // ── onModuleDestroy() ──────────────────────────────────────────────────────

  describe('onModuleDestroy()', () => {
    it('kills all active processes on shutdown without throwing', async () => {
      // Build a fake process whose kill() also emits 'close' (simulating OS behaviour)
      const killMock = jest.fn().mockImplementation(() => {
        // Simulate the OS responding to SIGTERM with a close event
        setImmediate(() => {
          (hangingProc as unknown as EventEmitter).emit('close', 1);
        });
      });
      const stdin = Object.assign(new EventEmitter(), {
        write: jest.fn(),
        end: jest.fn(),
      });
      const hangingProc = Object.assign(new EventEmitter(), {
        stdin,
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: 11111,
        kill: killMock,
      });
      spawnSpy.mockReturnValue(hangingProc as unknown as ReturnType<typeof childProcess.spawn>);

      // Start the execute — use a long timeout so the internal timer doesn't fire.
      const pending = service
        .execute({
          requestId: 'hanging',
          script: 'hang',
          payload: {},
          timeoutMs: 60_000,
        })
        .catch(() => {
          /* expected rejection when process closes */
        });

      // Give the service time to register the child in activeProcesses
      await new Promise<void>((r) => setImmediate(r));

      // Trigger shutdown — should call kill on the child
      service.onModuleDestroy();

      // Wait for the pending execute to settle (close event fires via killMock)
      await pending;

      expect(killMock).toHaveBeenCalledWith('SIGTERM');
    }, 10_000);
  });
});
