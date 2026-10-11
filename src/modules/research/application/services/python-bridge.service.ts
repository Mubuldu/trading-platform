import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { spawn, ChildProcess } from 'child_process';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ResearchPythonBridgeError } from '../../domain/errors/research.errors';

// ─── Protocol Types ────────────────────────────────────────────────────────────

export interface PythonRequest {
  readonly requestId: string;
  readonly script: string;
  readonly payload: Record<string, unknown>;
  /** Timeout in milliseconds. Defaults to 300_000 (5 min). */
  readonly timeoutMs?: number;
}

export interface PythonResponse {
  readonly requestId: string;
  readonly success: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: string;
  readonly logs?: string[];
}

/**
 * PythonBridgeService executes Python scripts in a subprocess and exchanges
 * structured JSON messages over stdin/stdout.
 *
 * Isolation contract:
 *   - The Python script runs as a separate OS process — any crash or
 *     hang is fully isolated from the NestJS runtime.
 *   - Scripts must be within the RESEARCH_PYTHON_SCRIPTS_DIR directory.
 *   - Network access within scripts is the operator's responsibility to restrict
 *     at the OS level (e.g. network namespaces, seccomp).
 *
 * Protocol (line-delimited JSON over stdin / stdout):
 *   → stdin:  one JSON line per request  { requestId, script, payload }
 *   ← stdout: one JSON line per response { requestId, success, result?, error?, logs? }
 *
 * The bridge harness script (research/python/bridge_harness.py) is the only
 * entry point; it receives the script name and payload, imports the named script
 * module from the scripts directory, and calls its `run(payload) -> dict` function.
 *
 * Supported ML frameworks (delegated to the script):
 *   TensorFlow, PyTorch, scikit-learn, pandas, numpy — any Python library
 *   installed in the research Python environment.
 */
@Injectable()
export class PythonBridgeService implements OnModuleDestroy {
  private readonly context = PythonBridgeService.name;

  /** Default script execution timeout. */
  private static readonly DEFAULT_TIMEOUT_MS = 300_000; // 5 min

  /**
   * Maximum bytes buffered from stdout before we treat the process as
   * producing garbage (prevents memory exhaustion by runaway scripts).
   */
  private static readonly MAX_STDOUT_BYTES = 10 * 1024 * 1024; // 10 MB

  private readonly activeProcesses = new Set<ChildProcess>();

  constructor(private readonly logger: AppLoggerService) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Execute a Python script and wait for its result.
   *
   * @param request  Script name, payload, and optional timeout.
   * @returns        Structured response from the script.
   * @throws         ResearchPythonBridgeError on process failure or timeout.
   */
  async execute(request: PythonRequest): Promise<PythonResponse> {
    const timeoutMs = request.timeoutMs ?? PythonBridgeService.DEFAULT_TIMEOUT_MS;

    this.logger.log(
      `Python bridge: executing script '${request.script}' ` +
        `(requestId=${request.requestId}, timeoutMs=${timeoutMs})`,
      this.context,
    );

    return new Promise<PythonResponse>((resolve, reject) => {
      let resolved = false;
      let stdoutBuf = '';
      let stderrBuf = '';

      const child = spawn('python3', ['-m', 'research.python.bridge_harness'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      this.activeProcesses.add(child);

      // ── timeout guard ────────────────────────────────────────────────────
      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        child.kill('SIGKILL');
        this.activeProcesses.delete(child);
        this.logger.warn(
          `Python bridge: script '${request.script}' timed out after ${timeoutMs}ms`,
          this.context,
        );
        reject(
          new ResearchPythonBridgeError(
            request.script,
            new Error(`Script timed out after ${timeoutMs}ms`),
          ),
        );
      }, timeoutMs);

      // ── send request ─────────────────────────────────────────────────────
      try {
        child.stdin!.write(JSON.stringify(request) + '\n');
        child.stdin!.end();
      } catch (writeErr) {
        clearTimeout(timer);
        resolved = true;
        this.activeProcesses.delete(child);
        reject(new ResearchPythonBridgeError(request.script, writeErr as Error));
        return;
      }

      // ── collect stdout ────────────────────────────────────────────────────
      child.stdout!.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        if (stdoutBuf.length > PythonBridgeService.MAX_STDOUT_BYTES) {
          resolved = true;
          clearTimeout(timer);
          child.kill('SIGKILL');
          this.activeProcesses.delete(child);
          reject(
            new ResearchPythonBridgeError(
              request.script,
              new Error('Script exceeded maximum stdout size (10 MB)'),
            ),
          );
        }
      });

      // ── collect stderr for logging ────────────────────────────────────────
      child.stderr!.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });

      // ── process exit ──────────────────────────────────────────────────────
      child.on('close', (code) => {
        clearTimeout(timer);
        this.activeProcesses.delete(child);
        if (resolved) return;
        resolved = true;

        if (stderrBuf) {
          this.logger.warn(
            `Python bridge stderr [${request.script}]: ${stderrBuf.trim()}`,
            this.context,
          );
        }

        if (code !== 0) {
          reject(
            new ResearchPythonBridgeError(
              request.script,
              new Error(`Process exited with code ${code}. stderr: ${stderrBuf.trim()}`),
            ),
          );
          return;
        }

        try {
          // Find the last non-empty line (the harness writes the JSON response last)
          const lines = stdoutBuf
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          const responseLine = lines[lines.length - 1];
          if (!responseLine) {
            throw new Error('No JSON response line found in stdout');
          }
          const response = JSON.parse(responseLine) as PythonResponse;
          resolve(response);
        } catch (parseErr) {
          reject(
            new ResearchPythonBridgeError(
              request.script,
              new Error(
                `Failed to parse script response: ${(parseErr as Error).message}. ` +
                  `stdout: ${stdoutBuf.slice(0, 500)}`,
              ),
            ),
          );
        }
      });

      child.on('error', (spawnErr) => {
        clearTimeout(timer);
        this.activeProcesses.delete(child);
        if (resolved) return;
        resolved = true;
        reject(new ResearchPythonBridgeError(request.script, spawnErr));
      });
    });
  }

  /**
   * Returns true if Python 3 is available in the environment.
   * Used for health checks — the bridge degrades gracefully when absent.
   */
  async isPythonAvailable(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const child = spawn('python3', ['--version'], { stdio: 'pipe' });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
      setTimeout(() => {
        child.kill();
        resolve(false);
      }, 3_000);
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  onModuleDestroy(): void {
    for (const child of this.activeProcesses) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    this.activeProcesses.clear();
    this.logger.log('PythonBridgeService: all child processes terminated', this.context);
  }
}
