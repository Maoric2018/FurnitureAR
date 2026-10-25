# Existing Runpod SAM 3D integration

This adapter uses the team's existing `/workspace/sam-3d-objects` checkout and CUDA environment. It does not install SAM 3D, download weights, reset the Pod, or modify the original notebooks.

## Files

- `api.py`: authenticated asynchronous upload, status and GLB download endpoints; SQLite job records; up to two simultaneous GPU jobs; at most four unfinished jobs; per-user idempotency and ownership.
- `infer.py`: the official `Inference` entry point in the existing environment, with the generated mesh written into the individual job directory.
- `test_api.py`: HTTP authorization, ownership, idempotency, queue and download checks, plus real worker-thread and file-lock concurrency checks without AI inference.
- `smoke_test.py`: an actual image → foreground mask → SAM 3D → GLB request. Accepts either the loopback URL on the Pod or the externally configured HTTPS URL.

The adapter calls the existing `auto_mask.py` using `/workspace/sam3d-mask-env/bin/python`, then activates `/workspace/miniforge3/envs/sam3d-objects` for inference. Each API worker holds its own shared lock on the notebook's `.sam3d-upload.lock`, allowing the API workers to run together. The notebook must continue using its exclusive lock, so notebook generation and API generation remain mutually exclusive. The UI reports actual stages, without estimated percentage completion.

## Start on the existing Pod

Copy these files into `/workspace/furniture-ar-api`. The base Python needs Tornado; the inspected Pod has version 6.5.10. No new Python package is required there.

Create an independent, random service credential in `api-key`, readable only by its owner. Keep it out of Git and frontend code. Then:

```sh
cd /workspace/furniture-ar-api
python test_api.py
SAM3D_MAX_WORKERS=2 nohup python api.py > api.log 2>&1 < /dev/null &
```

`SAM3D_MAX_WORKERS` defaults to `2` and accepts only the integers `1` or `2`; an invalid value stops startup. This is concurrency inside the existing Pod, not Runpod Serverless worker scaling, and does not create an additional GPU. Setting it to `1` restores serial inference. The existing cap of four unfinished jobs remains unchanged: at full utilization, two may run and two wait. Jobs waiting for the notebook GPU lock also remain queued.

The service binds only to `127.0.0.1:8765`. Every route, including `/health`, requires `Authorization: Bearer <service-key>` and `X-Furniture-User`. The website's backend supplies both. It does not use a Runpod account credential or Jupyter administration token. An authenticated `/health` response includes `ready`, `max_workers`, `running`, and `queued`; counts come from current job states and exclude completed or failed jobs. Readiness checks installed files, not whether two model copies fit in GPU memory.

Each job writes a private `data/<job-id>/timeline.jsonl` containing queue events and Unix timestamps for stage starts and finishes. The `reconstructing` interval includes starting the inference subprocess, loading the model, inference, and model export. Comparing these intervals verifies overlapping pipeline execution without changing the database schema. The logs contain no image payloads or API credentials and expire with the job directory.

Two independent inference subprocesses load separate model instances into the same GPU. Before relying on this setting, run two real image jobs together and check both valid GLB results, overlapping inference intervals, and peak GPU memory. The local concurrency tests do not prove the A40 can hold both workloads. If either real job runs out of memory, drain the queue, restart with `SAM3D_MAX_WORKERS=1`, and assess a lower-memory pipeline or additional GPU capacity.

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

The service uses the existing Pod's disk. No persistence across a Pod reset is promised. Before restarting the adapter, stop submitting jobs, wait for `/health` to report zero running and queued jobs, and confirm its mask/inference subprocesses have exited. Subprocesses run in their own process groups, so terminating only the API during a job can leave inference running after its GPU lock is released. Restarting the adapter marks interrupted jobs failed; create a fresh request to retry. Stopping/restarting the Pod or tunnel interrupts website generation. The existing rented Pod continues its normal billing while running; this adapter does not create another GPU instance.

Test the camera and physical AR placement separately on a supported phone over HTTPS. A desktop 3D preview does not verify phone tracking or camera permission behavior.

## Verified on October 24, 2026

- Existing Pod: `hmsjoavhims46i` (`civil_teal_limpet`), NVIDIA A40. Adapter installed at `/workspace/furniture-ar-api`; original notebooks preserved.
- Five provider HTTP tests passed. Website: 88 tests passed and production build passed.
- A real lamp photo completed automatic masking and SAM 3D inference in 81.2 seconds through the adapter; its GLB was 7,452,916 bytes. The downloaded file passed the website's embedded-asset and geometry checks.
- The approved HTTPS tunnel returned 200 for an authenticated health request and 401 without a key.
- A second, separate generation was submitted from the actual website at `http://127.0.0.1:5173/?photo=1`. Its real queued/processing/completed states appeared, the returned GLB rendered in the page, and setting a **test height** of 55 cm enabled the AR button. This is a test value, not a measurement of the pictured lamp.
- Desktop AR fallback displayed the correct supported-phone/HTTPS instructions; browser error logs were empty. Physical phone camera and AR tracking were not tested.

The verification above describes the original single-worker integration, not a dual-worker GPU benchmark. The **model API's** HTTPS tunnel does not itself host the website. A deployed website needs the two backend secrets configured separately. Do not expose Vite's mock local sign-in as public authentication.

## Two-worker deployment verified on October 24, 2026

- The existing A40 service was backed up and restarted with `SAM3D_MAX_WORKERS=2` after the queue was empty and GPU memory was idle. The Pod, notebooks, tunnel URL and service credential were preserved.
- All 12 provider tests passed locally and on the Pod, including overlapping worker threads, the third job waiting, notebook exclusion, failure recovery and authenticated health counts.
- Two distinct existing sample images (`03_lamp` and `07_chair`) were submitted together through the external HTTPS API. Both returned valid GLBs: 7,452,520 and 22,737,452 bytes respectively. Total verification time, including both downloads, was 164.4 seconds.
- The private stage timelines recorded 121.23 seconds of overlapping reconstruction. Two separate CUDA processes were also observed together. Sampled GPU usage peaked at 38,610 MiB of 46,068 MiB; neither job ran out of memory.
- Final authenticated health: `ready=true`, `max_workers=2`, `running=0`, `queued=0`. The deployed website uses this same API, so no frontend redeployment or URL change was required.
- The cloud verification summary and GPU samples are under `/workspace/furniture-ar-api/verification/workers2/`. The local report, GLBs and screenshots are under the ignored `verification/concurrency/` directory of the integration checkout.

This verifies two concurrent jobs for these inputs on the current GPU; it does not promise twice the throughput or sufficient memory for every possible image.
