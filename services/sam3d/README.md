# Existing Runpod SAM 3D integration

This adapter uses the team's existing `/workspace/sam-3d-objects` checkout and CUDA environment. It does not install SAM 3D, download weights, reset the Pod, or modify the original notebooks.

## Files

- `api.py`: authenticated asynchronous upload, status and GLB download endpoints; SQLite job records; one GPU job at a time; four-job queue; per-user idempotency and ownership.
- `infer.py`: the official `Inference` entry point in the existing environment, with the generated mesh written into the individual job directory.
- `test_api.py`: HTTP authorization, ownership, idempotency, queue and download checks without AI inference.
- `smoke_test.py`: an actual image → foreground mask → SAM 3D → GLB request. Accepts either the loopback URL on the Pod or the externally configured HTTPS URL.

The adapter calls the existing `auto_mask.py` using `/workspace/sam3d-mask-env/bin/python`, then activates `/workspace/miniforge3/envs/sam3d-objects` for inference. It shares the notebook's `.sam3d-upload.lock`, so a notebook generation and an API generation do not compete for GPU memory. The UI reports actual stages, without estimated percentage completion.

## Start on the existing Pod

Copy these files into `/workspace/furniture-ar-api`. The base Python needs Tornado; the inspected Pod has version 6.5.10. No new Python package is required there.

Create an independent, random service credential in `api-key`, readable only by its owner. Keep it out of Git and frontend code. Then:

```sh
cd /workspace/furniture-ar-api
python test_api.py
nohup python api.py > api.log 2>&1 < /dev/null &
```

The service binds only to `127.0.0.1:8765`. Every route, including `/health`, requires `Authorization: Bearer <service-key>` and `X-Furniture-User`. The website's backend supplies both. It does not use a Runpod account credential or Jupyter administration token.

Example real verification on the Pod:

```sh
python smoke_test.py \
  --image /workspace/sam-3d-objects/amazon_furniture_20261024/03_lamp/original.jpg \
  --output verification/lamp.glb
```

## Reach the service from the website

**Do not edit this existing Pod's exposed ports casually.** Its console warns that saving changes resets the Pod and loses data. A temporary HTTPS tunnel can expose only the adapter while preserving the running environment. Opening the tunnel is a separate deployment step; it is not performed by either test script.

Using the official Cloudflare `cloudflared` binary, after approval to expose the authenticated API:

```sh
nohup ./cloudflared tunnel --url http://127.0.0.1:8765 \
  > tunnel.log 2>&1 < /dev/null &
```

Set the resulting HTTPS URL as `MODEL_API_URL` and the independent service credential as `MODEL_API_KEY` in the website's server-only `.dev.vars`; restart Vite. Configure the equivalent secrets when deploying the existing website.

Quick Tunnels are for development/demo use. Their URL changes after restarting the tunnel, stops working when the process exits, and has no uptime guarantee. Use a named tunnel or a correctly provisioned dedicated API port for a durable deployment. See [Cloudflare's documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Limits and recovery

Uploads are capped at 8 MiB and returned GLBs at 25 MiB. There are at most four unfinished jobs and 60 retained jobs. Jobs belong to the authenticated website user. Completed/failed job folders expire after 24 hours; only this service's own `data` directory is cleaned. Model results are approximate and need a measured real-world height before AR placement.

The service uses the existing Pod's disk. No persistence across a Pod reset is promised. Restarting the adapter marks interrupted jobs failed; create a fresh request to retry. Stopping/restarting the Pod or tunnel interrupts website generation. The existing rented Pod continues its normal billing while running; this adapter does not create another GPU instance.

Test the camera and physical AR placement separately on a supported phone over HTTPS. A desktop 3D preview does not verify phone tracking or camera permission behavior.

## Verified on October 24, 2026

- Existing Pod: `hmsjoavhims46i` (`civil_teal_limpet`), NVIDIA A40. Adapter installed at `/workspace/furniture-ar-api`; original notebooks preserved.
- Five provider HTTP tests passed. Website: 88 tests passed and production build passed.
- A real lamp photo completed automatic masking and SAM 3D inference in 81.2 seconds through the adapter; its GLB was 7,452,916 bytes. The downloaded file passed the website's embedded-asset and geometry checks.
- The approved HTTPS tunnel returned 200 for an authenticated health request and 401 without a key.
- A second, separate generation was submitted from the actual website at `http://127.0.0.1:5173/?photo=1`. Its real queued/processing/completed states appeared, the returned GLB rendered in the page, and setting a **test height** of 55 cm enabled the AR button. This is a test value, not a measurement of the pictured lamp.
- Desktop AR fallback displayed the correct supported-phone/HTTPS instructions; browser error logs were empty. Physical phone camera and AR tracking were not tested.

The website is still a local development preview. The **model API's** HTTPS tunnel does not make the website accessible from a phone. Deploy the existing website with its original identity/access controls and the two backend secrets before phone testing. Do not expose Vite's mock local sign-in as public authentication.
