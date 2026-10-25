# Photo to 3D

The home page's **Open camera** card and **Photo to 3D** navigation open the photo studio. Visitors can use a live rear-camera preview, their phone's native camera, or a JPG/PNG/WebP file. Camera tracks stop on capture, exit, or a hidden tab. A selected photo is resized to 1600 pixels and re-encoded as JPEG before upload, discarding original EXIF metadata. Nothing is sent until **Generate 3D model** is pressed.

The studio submits an asynchronous generation, polls real status, displays an animation and provider-reported progress when available, downloads the returned GLB, and presents it in the existing 3D/AR viewer. It does not simulate generation or substitute a sample model. The user enters a measured height before AR is enabled; the exported model retains its proportions, is centered on X/Z, and rests on Y=0. The height is user-supplied, not recovered from the photo. A separate tap launches AR because browsers require a user gesture. The normalized GLB can also be downloaded.

## Current integration boundary

**The model runs on the team's existing Runpod GPU.** `services/sam3d/` contains an asynchronous API adapter for the inspected official SAM 3D installation, including the existing automatic foreground segmentation environment. It supports arbitrary uploaded photos and returns an actual generated mesh. See its README for deployment, tests, limits and recovery. The older Mac experiment in `experiments/sam3d-runtime/` is not the production inference entry point.

The adapter binds to loopback until HTTPS access is configured. When the website has no configured service, the studio clearly says generation is not connected and disables Generate, while allowing local photo capture/review. The presence of configuration alone does not guarantee that the GPU or tunnel is currently available; upload and polling failures are reported honestly.

Configure these server-only values in `.dev.vars`, then restart development:

```text
MODEL_API_URL=https://your-model-service.example/v1
MODEL_API_KEY=your-service-secret
```

The URL must be HTTPS; loopback HTTP is accepted for local integration. Do not expose these values through `VITE_` variables. No extra frontend dependency is needed. Hosted deployment must configure the same two runtime secrets on the existing Site, with its current audience preserved.

## Model service contract

`server/reconstruction-handler.ts` is the provider adapter. If the existing model uses a different API, map it here rather than changing the camera UI. All calls include `Authorization: Bearer MODEL_API_KEY` and `X-Furniture-User` with the authenticated Site identity. The provider must authenticate these requests, isolate users' jobs, and bound queued jobs/storage usage. The gateway also binds status/model access to signed, user-specific tickets that expire after 24 hours; API key rotation invalidates old tickets. The browser never receives the provider credential or provider URLs.

1. **POST `{MODEL_API_URL}/jobs`** — `multipart/form-data`, file field `image` (JPEG from this UI; adapter also accepts PNG/WebP, maximum 8 MiB). The gateway forwards an `Idempotency-Key` UUID. Persist and reuse the same job for retries of the same user's key; do not start another GPU job. Return promptly with HTTP 200/202 and the job object below, before running inference.
2. **GET `{MODEL_API_URL}/jobs/{id}`** — return the current job object. Job IDs must match `[A-Za-z0-9_-]{1,128}` and remain stable.
3. **GET `{MODEL_API_URL}/jobs/{id}/model`** — once successful, return the actual generated GLB with `Content-Type: model/gltf-binary`, maximum 25 MiB. Use glTF 2.0, Y-up geometry, and embedded textures/buffers. External assets, Gaussian-splat-only output, Draco/KTX-only assets requiring extra decoders, and invalid/empty geometry are unsupported. The model must represent the uploaded photo's subject. Return a non-success response until the model exists.

Example status response:

```json
{
  "id": "job_abc123",
  "status": "processing",
  "stage": "reconstructing",
  "progress": 42
}
```

`status` is `queued`, `processing`, `succeeded`, or `failed`. Optional `stage` is `preparing`, `reconstructing`, `texturing`, or `exporting`. Optional `progress` is an actual number from 0 to 100. Omit it when no reliable measurement exists; the UI then uses an indeterminate animation. Error bodies and unknown fields are not forwarded to the browser.

## Browser routes and behavior

- `GET /api/reconstruction/config`: availability and sign-in status; no credentials.
- `POST /api/reconstruction/jobs`: authenticated upload.
- `GET /api/reconstruction/jobs/{ticket}`: owner-bound status.
- `GET /api/reconstruction/jobs/{ticket}/model`: owner-bound model download through the same origin.

The local Sites sign-in remains in use. Sign in before capture; signing in navigates away and the photo is deliberately not persisted. Only a job ticket/status is saved in session storage so reopening Photo to 3D in the same tab resumes polling. Photos, result blobs, and height input remain in memory. Once generated, download the GLB to keep it. There is no automatic addition to Saved items or cross-device job synchronization.

Status checks retry temporary network errors up to three times. After 20 minutes of polling, a visible **Check status again** button resumes without starting another generation. Failed jobs allow a fresh photo. Leaving the page stops local polling/camera use, but does not cancel an already accepted GPU job; the service owns cancellation/retention policies. Upload retries preserve the same idempotency key while the current page remains open. Generation creation is limited to four attempts per five minutes per user per Worker instance; enforce production quotas at the provider too.

## Verification

Run `npm test` and `npm run build`. `tests/reconstruction.test.ts` checks the upload → queued job → completed job → GLB contract with a simulated provider, user isolation, ticket expiry, invalid files, credential-safe errors, measured-height normalization and embedded-asset validation. These tests do not run AI inference. Camera permission/device behavior and AR tracking require testing on a real phone over HTTPS.
