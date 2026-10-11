/**
 * Machine-learning frameworks supported by the research sandbox.
 *
 * TYPESCRIPT_NATIVE  — Pure TypeScript (no Python bridge required).
 * PYTHON_TENSORFLOW  — TensorFlow via Python bridge.
 * PYTHON_PYTORCH     — PyTorch via Python bridge.
 * ONNX               — Exported ONNX model, inferred via onnxruntime-node.
 * R                  — R language (future support, not yet implemented).
 */
export enum MlFramework {
  TYPESCRIPT_NATIVE = 'TYPESCRIPT_NATIVE',
  PYTHON_TENSORFLOW = 'PYTHON_TENSORFLOW',
  PYTHON_PYTORCH = 'PYTHON_PYTORCH',
  ONNX = 'ONNX',
  R = 'R',
}
