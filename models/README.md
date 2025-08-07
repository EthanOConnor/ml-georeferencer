# Models

Model weights are **not** stored in git. Use `scripts/fetch-models.sh` to download them
to this folder. Each artifact should include a `SHA256SUMS` file to verify integrity.

Recommended baselines:
- Keypoint/descriptor: SuperPoint‑like ONNX
- Graph matcher: LightGlue‑like ONNX
- Dense flow: RAFT‑like ONNX (optional, later)

Packaging: keep models per‑arch if needed, and prefer quantized variants for mobile.
