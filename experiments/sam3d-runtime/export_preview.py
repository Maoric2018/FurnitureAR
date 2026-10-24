"""Bounded textured export of a completed SAM 3D latent; no inference rerun."""
from pathlib import Path
from types import SimpleNamespace
import argparse
import gc
import json
import time

import trial  # Sets the isolated cache paths and conservative MPS settings.
import numpy as np
import torch
import trimesh
import open3d as o3d
from ply2glb import load_slat, load_mesh_decoder, load_gaussian, empty_device_cache
from sam3d_objects.model.backbone.tdfy_dit.utils.postprocessing_utils import to_glb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--faces', type=int, default=20000)
    parser.add_argument('--views', type=int, default=24)
    parser.add_argument('--decode-device', choices=['cpu', 'mps'], default='cpu')
    args = parser.parse_args()
    folder = args.folder.resolve()
    assert 1000 <= args.faces <= 100000 and 8 <= args.views <= 100
    assert (folder / 'splat.ply').is_file() and (folder / 'slat.pt').is_file()
    started = time.monotonic()
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    raw_path = folder / f'decoded-mesh-{args.decode_device}.ply'
    if not raw_path.exists():
        print(f'Decoding mesh from the saved latent on {args.decode_device}...', flush=True)
        if args.decode_device == 'cpu':
            torch.set_num_threads(8)
        slat = load_slat(str(folder / 'slat.pt')).to(args.decode_device)
        decoder = load_mesh_decoder(args.decode_device)
        with torch.no_grad():
            result = decoder(slat)[0]
        vertices = result.vertices.float().cpu().numpy()
        faces = result.faces.cpu().numpy()
        finite_vertices = np.isfinite(vertices).all(axis=1)
        finite_faces = finite_vertices[faces].all(axis=1)
        diagnostic = {'device': args.decode_device, 'vertices': len(vertices), 'faces': len(faces),
                      'invalid_vertices': int((~finite_vertices).sum()),
                      'invalid_faces': int((~finite_faces).sum())}
        (folder / f'decode-{args.decode_device}.json').write_text(json.dumps(diagnostic, indent=2) + '\n')
        print(json.dumps(diagnostic), flush=True)
        if not finite_vertices.all() or not len(faces):
            np.savez_compressed(folder / f'invalid-mesh-{args.decode_device}.npz', vertices=vertices, faces=faces)
            raise SystemExit('Mesh decoder produced invalid geometry; preserved diagnostics and rejected export.')
        trimesh.Trimesh(vertices=vertices, faces=faces, process=False).export(raw_path)
        del result, slat, decoder
        gc.collect()
        empty_device_cache(args.decode_device)
    raw = trimesh.load(raw_path, force='mesh', process=False)
    print(f'Raw geometry: {len(raw.vertices):,} vertices, {len(raw.faces):,} faces', flush=True)
    mesh = o3d.geometry.TriangleMesh(
        o3d.utility.Vector3dVector(np.asarray(raw.vertices, dtype=np.float64)),
        o3d.utility.Vector3iVector(np.asarray(raw.faces, dtype=np.int32)),
    )
    mesh.remove_duplicated_vertices()
    mesh.remove_duplicated_triangles()
    mesh.remove_degenerate_triangles()
    mesh.remove_unreferenced_vertices()
    if len(mesh.triangles) > args.faces:
        mesh = mesh.simplify_quadric_decimation(args.faces)
        mesh.remove_degenerate_triangles()
        mesh.remove_unreferenced_vertices()
    vertices = np.asarray(mesh.vertices, dtype=np.float32)
    faces = np.asarray(mesh.triangles, dtype=np.int64)
    assert np.isfinite(vertices).all() and 0 < len(faces) <= args.faces * 1.1
    print(f'Preview geometry: {len(vertices):,} vertices, {len(faces):,} faces', flush=True)
    bounded = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    geometry_preview = bounded.copy()
    geometry_preview.vertices = geometry_preview.vertices @ np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]])
    geometry_preview.export(folder / 'preview-geometry.glb')
    result = SimpleNamespace(vertices=torch.from_numpy(vertices), faces=torch.from_numpy(faces),
                             vertex_attrs=torch.ones((len(vertices), 3)))
    gs = load_gaussian(str(folder / 'splat.ply'), device)
    print(f'Baking a 1024px texture from {args.views} views...', flush=True)
    glb = to_glb(gs, result, simplify=0, fill_holes=False,
                 texture_size=1024, texture_views=args.views, texture_render_resolution=512,
                 texture_mode='average', with_mesh_postprocess=False,
                 with_texture_baking=True, use_vertex_color=False, rendering_engine='pytorch3d')
    destination = folder / 'preview.glb'
    glb.export(destination)
    checked = trimesh.load(destination, force='scene')
    assert checked.geometry and np.isfinite(checked.bounds).all() and np.all(checked.extents > 0)
    for geometry in checked.geometry.values():
        assert np.isfinite(geometry.vertices).all() and len(geometry.faces)
        assert geometry.visual.uv is not None and np.isfinite(geometry.visual.uv).all()
        assert geometry.visual.material.baseColorTexture is not None
    report = {'export_seconds': round(time.monotonic() - started, 1), 'model': str(destination),
              'decode_device': args.decode_device,
              'vertices': sum(len(g.vertices) for g in checked.geometry.values()),
              'triangles': sum(len(g.faces) for g in checked.geometry.values()),
              'bytes': destination.stat().st_size, 'bounds': checked.bounds.tolist(),
              'texture_size': 1024, 'texture_views': args.views, 'scale_verified': False,
              'source': 'Saved SAM 3D latent from repository side-table example, mask 20.png'}
    (folder / 'preview-result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
