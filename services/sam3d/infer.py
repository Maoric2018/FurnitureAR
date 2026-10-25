"""Run the existing official SAM 3D environment, exporting into one API job."""
import argparse
import os
from pathlib import Path
import sys

p = argparse.ArgumentParser()
p.add_argument("--root", type=Path, required=True)
p.add_argument("--job", type=Path, required=True)
a = p.parse_args()
os.chdir(a.root)
sys.path.insert(0, str(a.root))
sys.path.insert(0, str(a.root / "notebook"))
import numpy as np
from PIL import Image
import torch
import trimesh
from inference import Inference, load_image

if not torch.cuda.is_available():
    raise RuntimeError("CUDA unavailable")
mask = np.array(Image.open(a.job / "mask.png").convert("L")) > 127
if not mask.any():
    raise ValueError("Empty foreground mask")
model = Inference(str(a.root / "checkpoints/hf/pipeline.yaml"), compile=False)
result = model(load_image(str(a.job / "image.png")), mask, seed=42)
mesh = result.get("glb")
if mesh is None:
    raise RuntimeError("SAM 3D returned no mesh")
(a.job / "exporting").touch()
path = a.job / "model.glb"
mesh.export(str(path))
scene = trimesh.load(str(path), force="scene")
if not scene.geometry or not np.isfinite(scene.bounds).all():
    raise ValueError("Invalid geometry")
if sum(len(g.vertices) for g in scene.geometry.values()) == 0:
    raise ValueError("Empty geometry")
print("MODEL_READY", flush=True)
