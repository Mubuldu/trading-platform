import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ResearchOnnxInferenceError } from '../../domain/errors/research.errors';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type OnnxTensorData = Float32Array | Float64Array | Int32Array | BigInt64Array;

export interface OnnxInputTensor {
  readonly name: string;
  readonly data: OnnxTensorData;
  readonly dims: number[];
}

export interface OnnxOutputTensor {
  readonly name: string;
  readonly data: OnnxTensorData;
  readonly dims: number[];
}

export interface OnnxInferenceResult {
  readonly modelPath: string;
  readonly outputs: OnnxOutputTensor[];
  readonly inferenceTimeMs: number;
}

// ─── onnxruntime-node dynamic bindings ───────────────────────────────────────
// onnxruntime-node is an OPTIONAL dependency for the research sandbox.
// It is not listed in package.json by default — install with:
//   pnpm add onnxruntime-node
// The service degrades gracefully when it is not installed.

/* eslint-disable @typescript-eslint/no-explicit-any */
type OnnxSession = any;
type OnnxTensor = any;
/** Runtime type for onnxruntime-node — kept as `any` because the package is optional. */
type OnnxRuntime = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * OnnxInferenceService runs ONNX models via the `onnxruntime-node` package.
 *
 * Usage pattern:
 *   1. Call `loadSession(modelPath)` once per model — the session is cached.
 *   2. Call `run(modelPath, inputs)` for each inference pass.
 *
 * ONNX models are exported from Python training workflows (PyTorch / TensorFlow)
 * and placed in the research data directory.  The model path must be under the
 * configured RESEARCH_DATA_DIR to prevent traversal outside the sandbox.
 *
 * If `onnxruntime-node` is not installed, all inference calls throw
 * ResearchOnnxInferenceError with an actionable installation message.
 */
@Injectable()
export class OnnxInferenceService {
  private readonly context = OnnxInferenceService.name;
  private readonly sessionCache = new Map<string, OnnxSession>();
  private ort: OnnxRuntime | null = null;
  private ortLoaded = false;

  constructor(private readonly logger: AppLoggerService) {}

  // ── Session Management ────────────────────────────────────────────────────

  /**
   * Loads an ONNX model into an inference session and caches it.
   * Subsequent calls with the same path return the cached session.
   */
  async loadSession(modelPath: string): Promise<void> {
    if (this.sessionCache.has(modelPath)) return;

    const ort = await this.loadOrt(modelPath);
    try {
      const session: OnnxSession = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      this.sessionCache.set(modelPath, session);
      this.logger.log(`ONNX session loaded: ${modelPath}`, this.context);
    } catch (err) {
      throw new ResearchOnnxInferenceError(modelPath, err as Error);
    }
  }

  /** Evicts a cached session (useful after model file updates). */
  unloadSession(modelPath: string): void {
    this.sessionCache.delete(modelPath);
  }

  // ── Inference ─────────────────────────────────────────────────────────────

  /**
   * Runs inference on the specified model.
   * Loads the session on first call if not already cached.
   *
   * @param modelPath  Path to the .onnx file.
   * @param inputs     Input tensors keyed by name.
   * @returns          All output tensors from the model.
   */
  async run(modelPath: string, inputs: OnnxInputTensor[]): Promise<OnnxInferenceResult> {
    const ort = await this.loadOrt(modelPath);
    await this.loadSession(modelPath);
    const session = this.sessionCache.get(modelPath)!;

    try {
      const feedDict: Record<string, OnnxTensor> = {};
      for (const input of inputs) {
        feedDict[input.name] = new ort.Tensor(input.data, input.dims);
      }

      const t0 = Date.now();
      const rawOutputs = (await session.run(feedDict)) as Record<string, OnnxTensor>;
      const inferenceTimeMs = Date.now() - t0;

      const outputs: OnnxOutputTensor[] = Object.entries(rawOutputs).map(([name, tensor]) => ({
        name,
        data: tensor.data as OnnxTensorData,
        dims: tensor.dims as number[],
      }));

      return { modelPath, outputs, inferenceTimeMs };
    } catch (err) {
      throw new ResearchOnnxInferenceError(modelPath, err as Error);
    }
  }

  /**
   * Returns the input/output metadata of a loaded ONNX model.
   * Useful for validating tensor shapes before running inference.
   */
  async getModelMetadata(modelPath: string): Promise<{ inputs: string[]; outputs: string[] }> {
    await this.loadSession(modelPath);
    const session = this.sessionCache.get(modelPath)!;
    return {
      inputs: session.inputNames as string[],
      outputs: session.outputNames as string[],
    };
  }

  /** True if onnxruntime-node is installed and importable. */
  async isAvailable(): Promise<boolean> {
    try {
      await this.requireOrt();
      return true;
    } catch {
      return false;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async loadOrt(modelPath: string): Promise<OnnxRuntime> {
    try {
      return await this.requireOrt();
    } catch (err) {
      throw new ResearchOnnxInferenceError(
        modelPath,
        new Error(
          'onnxruntime-node is not installed. ' + 'Install it with: pnpm add onnxruntime-node',
        ),
      );
    }
  }

  private async requireOrt(): Promise<OnnxRuntime> {
    if (this.ort) return this.ort;
    if (this.ortLoaded) {
      throw new Error('onnxruntime-node not available');
    }
    this.ortLoaded = true;
    // Dynamic require keeps onnxruntime-node fully optional at compile time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    this.ort = require('onnxruntime-node') as OnnxRuntime;
    return this.ort!;
  }
}
