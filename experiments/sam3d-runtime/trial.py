"""Isolated SAM 3D Mac trial; does not modify the Furniture AR app."""
from pathlib import Path
import argparse
import json
import os
import subprocess
import sys
import time

RUNTIME = Path(__file__).resolve().parent
ROOT = RUNTIME.parent
REPO = ROOT / 'sam3d-objects-mac'
CHECKPOINTS = REPO / 'checkpoints/hf/checkpoints'
SAMPLE = REPO / 'notebook/images/shutterstock_stylish_kidsroom_1640806567'
REQUIRED = ['pipeline.yaml', 'ss_generator.ckpt', 'slat_generator.ckpt',
            'ss_decoder.ckpt', 'slat_decoder_gs.ckpt', 'slat_decoder_mesh.ckpt']
for name, value in {
    'SPARSE_BACKEND': 'native', 'ATTN_BACKEND': 'sdpa',
    'SPARSE_ATTN_BACKEND': 'sdpa', 'PYTORCH_ENABLE_MPS_FALLBACK': '1',
    'PYTORCH_MPS_HIGH_WATERMARK_RATIO': '1.0',
    'PYTORCH_MPS_LOW_WATERMARK_RATIO': '0.9',
    'GRADIO_ANALYTICS_ENABLED': 'False', 'LIDRA_SKIP_INIT': 'true',
    'HF_HOME': str(RUNTIME / '.hf'), 'TORCH_HOME': str(RUNTIME / 'torch-cache'),
    'MPLCONFIGDIR': str(RUNTIME / 'matplotlib'),
}.items():
    os.environ.setdefault(name, value)
sys.path[:0] = [str(REPO), str(REPO / 'notebook')]


def missing_weights():
    return [name for name in REQUIRED if not (CHECKPOINTS / name).is_file()
            or (CHECKPOINTS / name).stat().st_size == 0]


def preflight():
    import torch
    from inference import Inference
    from pytorch3d.transforms import Transform3d
    from sam3d_objects.model.backbone.tdfy_dit.modules.sparse.conv.conv_native import _subm_forward
    import trimesh
    import numpy as np
    assert Inference is not None and Transform3d is not None
    assert torch.backends.mps.is_available(), 'Apple GPU unavailable; run outside the restricted sandbox.'
    torch.manual_seed(7)
    coords = torch.tensor([[0, z, y, x] for z in range(3) for y in range(3) for x in range(3)], dtype=torch.int32)
    features, weight = torch.randn(27, 4), torch.randn(3, 3, 3, 4, 6)
    expected = _subm_forward(features, coords, weight, None)
    actual = _subm_forward(features.to('mps'), coords.to('mps'), weight.to('mps'), None).cpu()
    torch.testing.assert_close(actual, expected, rtol=1e-4, atol=1e-4)
    half = _subm_forward(features.half().to('mps'), coords.to('mps'), weight.half().to('mps'), None).float().cpu()
    torch.testing.assert_close(half, expected, rtol=.02, atol=.06)
    model = trimesh.load(ROOT.parent / 'public/models/little-tree-oak-table.glb', force='scene')
    np.testing.assert_allclose(model.extents, [1.199896, .750062, 1.199896], atol=.0001)
    roundtrip = RUNTIME / 'oak-table-export-check.glb'
    model.export(roundtrip)
    np.testing.assert_allclose(trimesh.load(roundtrip, force='scene').extents, model.extents, atol=.0001)
    report = {'torch': torch.__version__, 'mps': True, 'sparse_convolution_fp32': 'passed',
              'sparse_convolution_fp16': 'passed', 'imports': 'passed',
              'existing_glb_roundtrip': 'passed', 'missing_weights': missing_weights(),
              'generated_new_model': False,
              'source_commit': subprocess.check_output(['git', '-C', str(REPO), 'rev-parse', 'HEAD'], text=True).strip()}
    (RUNTIME / 'preflight.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


def download():
    from huggingface_hub import get_token, get_hf_file_metadata, hf_hub_url, snapshot_download
    from huggingface_hub.errors import GatedRepoError, HfHubHTTPError
    token = get_token()
    if not token:
        raise SystemExit('Model download needs your approved Hugging Face login. Authenticate with the Hugging Face CLI using HF_HOME set to this runtime’s .hf folder.')
    try:
        get_hf_file_metadata(hf_hub_url('facebook/sam-3d-objects', 'checkpoints/pipeline.yaml'), token=token)
    except (GatedRepoError, HfHubHTTPError):
        raise SystemExit('This login cannot download the checkpoints yet. Request access on the official model page, then retry.')
    snapshot_download('facebook/sam-3d-objects', allow_patterns=['checkpoints/*'],
                      local_dir=CHECKPOINTS.parent, max_workers=2, token=token)
    if missing_weights():
        raise SystemExit('Download incomplete: ' + ', '.join(missing_weights()))
    print('Required checkpoints downloaded.', flush=True)


def generate(output):
    import numpy as np
    from PIL import Image
    from cli import run_pipeline
    views = [{'path': str(SAMPLE / 'image.png'), 'rgb': np.array(Image.open(SAMPLE / 'image.png').convert('RGB'))}]
    mask_image = Image.open(SAMPLE / '20.png')
    # Repository examples keep the RGB photo beneath a binary alpha mask.
    # Converting RGBA to grayscale would select almost the entire room.
    mask = np.array(mask_image.getchannel('A') if 'A' in mask_image.getbands()
                    else mask_image.convert('L')) > 0
    assert mask.shape == views[0]['rgb'].shape[:2]
    assert 0 < np.count_nonzero(mask) < mask.size * .95, 'Expected an object mask, not the whole image.'
    if not run_pipeline(views, [mask], str(output), steps=10, seed=22):
        raise SystemExit('Generation failed. See the run log; no successful model is claimed.')


def run():
    missing = missing_weights()
    if missing:
        raise SystemExit('Cannot start reconstruction: missing Meta checkpoints. Run the download step after Hugging Face access is approved.')
    output = RUNTIME / 'outputs' / time.strftime('side-table-%Y%m%d-%H%M%S')
    output.mkdir(parents=True, exist_ok=False)
    start = time.monotonic()
    # Use MPS for reconstruction, then a fresh process with CPU mesh decoding.
    # The MPS mesh decoder produced invalid vertices on the tested M5 Pro.
    subprocess.run([sys.executable, __file__, '_generate', '--output', str(output)], check=True)
    subprocess.run([sys.executable, str(RUNTIME / 'export_preview.py'), str(output),
                    '--decode-device', 'cpu'], cwd=REPO, check=True)
    import trimesh
    import numpy as np
    model_path = output / 'preview.glb'
    model = trimesh.load(model_path, force='scene')
    assert len(model.geometry) and np.isfinite(model.bounds).all() and np.all(model.extents > 0)
    report = {'seconds': round(time.monotonic() - start, 1), 'model': str(model_path),
              'bounds': model.bounds.tolist(), 'scale_verified': False,
              'input': str(SAMPLE / 'image.png'), 'mask': '20.png alpha channel', 'steps': 10, 'seed': 22,
              'mesh_decode_device': 'cpu', 'texture_size': 1024, 'texture_views': 24}
    (output / 'trial-result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preflight', 'download', 'run', '_generate'])
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.action == '_generate':
        if args.output is None:
            parser.error('--output is required for the worker')
        generate(args.output)
    else:
        {'preflight': preflight, 'download': download, 'run': run}[args.action]()
