# SAM 3D local Mac experiment

This experiment is separate from the Furniture AR website. It reconstructs a side table from a repository example photograph and its supplied mask; it does not yet turn arbitrary Amazon links into models.

## Tested environment

- Apple M5 Pro, 48 GB unified memory; Python 3.11.14, PyTorch 2.12.0, torchvision 0.27.0.
- Community Mac port: https://github.com/ankitmahala07/sam3d-objects-mac at commit `2ed940d1edbc86d3aae8c96dcbde3e8437b18f07`.
- Official gated model: https://huggingface.co/facebook/sam-3d-objects. Download requires account approval and a repository-scoped read token.
- Full environment versions are recorded in `installed-requirements.txt`. The original port's CUDA-oriented requirements were not installed unchanged.
- MPS sparse-convolution float32/float16 checks passed. The corrected isolated-table run completed in **601.2 seconds (10 minutes 1 second)**, excluding initial checkpoint downloads. Its alpha mask was visually verified before launch.
- Inference: **309.6 seconds**, 10 steps per stage, seed 22, 343,712 finite Gaussian splats. CPU decoding and bounded texture export: **262.0 seconds**, including startup, geometry preparation, and texture baking.
- Final GLB: **1,876,964 bytes**, **16,468 vertices**, **20,000 triangles**, embedded **1024×1024 color texture**, 24 bake views. Geometry and UVs are finite; CPU decoding reported zero invalid vertices or faces.
- Browser visual check passed: an isolated white flower-shaped tabletop with four wooden legs appears and rotates in 3D. Small floating fragments and edge/texture artifacts remain. This is a working preview, not a verified exact product reconstruction.

## Compatibility patch

Apply `mac-trial.patch` in the Mac-port checkout. MoGe returns half-precision points under MPS autocast, while the PyTorch3D camera transform is float32. Converting the pointmap to float32 before camera conversion fixes the observed `Expected arguments of same type but got Half and Float` failure. The patch also lets the CLI accept a fixed seed, used as 22 by the wrapper.

The tested MPS mesh decoder produced non-finite vertices. CPU float32 mesh decoding produced zero invalid vertices or faces from the same latent. `trial.py run` therefore uses MPS for diffusion, CPU for mesh decoding, and MPS for texture rendering. Repository RGBA masks are read from their alpha channel, never converted to grayscale.

## Folder layout and commands

Keep the checkout as `sam3d-objects-mac`, virtual environment as `s3d_env`, and these scripts as `sam3d-runtime` beneath one parent folder. Run GPU commands from a normal terminal with Metal access.

On a fresh Mac, Git and Apple's command-line C/C++ build tools are required for PyTorch3D. The tested installation used `uv`; no CUDA, Conda, or Homebrew packages were needed. From the parent folder:

```sh
git clone https://github.com/ankitmahala07/sam3d-objects-mac.git
git -C sam3d-objects-mac checkout 2ed940d1edbc86d3aae8c96dcbde3e8437b18f07
git -C sam3d-objects-mac apply ../sam3d-runtime/mac-trial.patch
uv venv --python 3.11 s3d_env
uv pip install --python s3d_env/bin/python torch==2.12.0 torchvision==0.27.0 numpy==1.26.4 setuptools==81.0.0 wheel==0.48.0 ninja==1.13.2 packaging==24.2
MAX_JOBS=2 uv pip install --python s3d_env/bin/python --no-build-isolation -r sam3d-runtime/installed-requirements.txt
```

The requirements file contains only package versions and three public GitHub commit URLs; it contains no local paths or authentication. These commands reconstruct the tested dependency choices; the clean installation as a single requirements command has not been separately rerun.

```sh
cd sam3d-runtime
../s3d_env/bin/python trial.py preflight
../s3d_env/bin/python trial.py download
mkdir -p outputs/my-test
../s3d_env/bin/python -u trial.py _generate --output outputs/my-test
../s3d_env/bin/python -u export_preview.py outputs/my-test
```

Use a new output folder for each generation. The example photograph and table mask are `notebook/images/shutterstock_stylish_kidsroom_1640806567/image.png` and the alpha channel of `20.png` in the port checkout. The wrapper fixes seed 22 for both diffusion stages; exact numerical results may still differ across hardware and library versions. `trial.py run` automates generation and bounded export in a new timestamped output folder.

`trial.py` isolates Hugging Face/Torch caches and keeps the MPS memory ceiling enabled. Store authentication only in `.hf/token` with file mode 0600 and parent directory mode 0700, or use the official Hugging Face CLI with `HF_HOME` set to `.hf`. Never commit the token, cache, model checkpoints, or environment.

## Bounded preview export

The default MPS mesh export reached UV unwrapping but produced invalid vertices, discovered by the stricter validator. That export was stopped; its output is not a usable furniture result. The CPU fallback is used by default.

`export_preview.py` reuses `slat.pt` and `splat.ply`, decodes on CPU in float32 by default, records invalid vertex/face counts, caches valid decoded geometry, cleans duplicate/degenerate geometry, and uses Open3D to target 20,000 triangles before UV unwrapping. It bakes a 1024px texture from 24 views rendered at 512px. It produces `preview.glb` and `preview-result.json`, and asserts finite geometry, UV coordinates, positive bounds, and an embedded color texture. This is a preview-quality path rather than a high-detail export benchmark.

The validated run is `outputs/side-table-20261024-164828`. Its `trial-result.json` and `preview-result.json` record timings and geometry bounds; `table-comparison.png` shows the masked input beside the rendered GLB. Bounds are normalized model coordinates, not verified meters. An earlier wrong-mask room reconstruction remains only as diagnostic evidence and is not the intended sample.

## Application limits

Physical dimensions are not recovered or verified by this experiment. Furniture AR still needs listing dimensions to scale the model, plus orientation/floor normalization and a background generation job with caching. A supplied object mask is used here; automatic masking of arbitrary product photos is not covered by this test. Native phone AR and reconstruction accuracy have not been measured.
