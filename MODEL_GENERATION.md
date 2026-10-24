# Amazon photo-to-GLB integration

The product-selection path now uses the real SAM 3D service through `server/model-generator.js`. It downloads the verified Amazon CDN photo (maximum 8 MiB), submits a private asynchronous job, polls its actual stage, and normalizes the returned GLB before caching. The existing exact-ASIN cache and registered models take priority. No demo model is substituted.

## Selection and reuse

1. Search selection and pasted Amazon links both call `POST /api/products/import`.
2. The server normalizes the link to an exact Amazon.com ASIN and checks persistent model storage before contacting SerpApi. Tracking tags and different Amazon URL formats resolve to the same key. A different color or size ASIN gets its own key.
3. A completed generated model returns immediately with the stored listing snapshot. This skips both the product API lookup and generation. Keyword search is a separate API call and is not eliminated by the model cache.
4. On a cache miss, the server imports the listing, preserves any registered model, and otherwise passes the confirmed product identity and primary photo to the generator adapter. Recent product details can be reused without another lookup.
5. A generator can return a completed model immediately or a pending job. Pending jobs are checked through `GET /api/products/models/<ASIN>`, which does not call Amazon. The preview updates when the job finishes.
6. The server validates the returned GLB, writes its bytes, and only then records a ready model. Incomplete generation and failed storage writes never become a reusable ready entry.

Prices, stock, images, and color options stored beside a completed model are import snapshots, not a current availability guarantee. They retain their original `retrievedAt`. Generated geometry is kept until explicitly replaced or removed by the operator; it does not expire just because a listing snapshot is old. The exact ASIN establishes cache identity, not proof that an Amazon listing can never change.

## Persistent files

`MODEL_BUCKET` is the website's R2 binding, declared in `.openai/hosting.json` and in the local Worker configuration. The website serves model files through its own API routes; no public bucket or browser storage credentials are required.

Objects are grouped under:

```text
generated-models/amazon-com/<ASIN>/
```

`metadata.json` records the canonical `https://www.amazon.com/dp/<ASIN>` link, listing, model description, generator version, status, and timestamps. GLB filenames include their SHA-256 hash. The model URL has the form:

```text
/api/products/models/<ASIN>/<sha256>.glb
```

Hosted Workers cannot write new files into the deployed `public/` folder. R2 is the persistent folder for generated files; `public/models/` remains the authored asset catalog. Local development uses Cloudflare's local R2 implementation under the ignored `.wrangler/` state directory. Restarting the dev server preserves that data. Local and deployed buckets are separate; local models are not uploaded merely by building or pushing Git.

Publishing the current Sites project provisions its declared storage binding. If deploying independently through Cloudflare, create/bind the `furniture-ar-models` bucket as `MODEL_BUCKET`. If storage is missing or unavailable, browsing still works and the generator is not allowed to claim a persistently cached model. The existing Sites project is currently inaccessible through this chat's connected account, so its hosted storage and deployment have not been changed.

Cloudflare documents the [R2 Worker binding and object API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) and [persistent local development data](https://developers.cloudflare.com/workers/local-development/local-data/).

## SAM 3D configuration

Set `MODEL_API_URL` and `MODEL_API_KEY` in the ignored `.dev.vars` locally, or in server runtime secrets for deployment. These are the same settings as the camera studio. The current temporary HTTPS connection must remain running alongside the existing Runpod service. If its address changes, update the URL and restart the website; credentials never enter the frontend. Fresh Amazon searches/imports also need `SERPAPI_API_KEY`.

The adapter converts its stable versioned cache identity into the UUID-shaped idempotency key accepted by the Pod and uses a dedicated catalog owner. Camera jobs remain isolated to their signed-in owners. Amazon imports remain available to guests. The Pod limits the shared catalog to four new jobs per five minutes and four queued/running jobs overall. Temporary polling outages retain the accepted job instead of creating another. Actual inference failures stay failed for that idempotency key until provider retention expires (24 hours); inspect its private job logs before retrying.

`server/sam3d-glb.js` reads actual static mesh positions and node transforms, retains embedded materials/binary data, and adds a uniform scale/translation. Height is preferred, then width, then depth. `product.scaleReference` records the chosen listing axis. With no usable axis it is `preview`: a reference height of 1 m, explicitly labeled, with AR/layout placement blocked. The other dimensions follow reconstructed proportions, not forced listing dimensions. Animated, skinned, externally referenced, invalid, or excessively complex meshes fail validation.

## Adapter contract

The exported `modelGenerator` implements a versioned `start(input, env)` / `poll(input, env)` contract. Runtime secrets are supplied in the second argument and are never stored in model metadata. Input includes the exact ASIN, canonical product URL, chosen photo URL, full imported listing, a stable idempotency key, and an `AbortSignal`. The generator must use that key when submitting work to prevent duplicate jobs across Worker instances. Repeated requests within one Worker are coalesced. Conditional R2 writes coordinate short job leases and prevent a late pending response from replacing a completed model; the provider idempotency key covers retries after a crash or expired lease.

The adapter returns one of these results:

```ts
// The service URL/key is missing or invalid.
{ status: 'not_configured' }

// A remote job has been accepted. poll receives its job ID.
{ status: 'pending', jobId: 'provider-job-id', stage: 'reconstructing' }

// A successful conversion, from start or poll.
{
  status: 'ready',
  glb: new Uint8Array(/* complete binary GLB */),
  dimensions: { width: 1.2, height: 0.75, depth: 1.2 },
  category: 'Tables',
  material: 'Oak finish',
  colorName: 'Oak',
  color: '#b68d5d'
}

// A conversion failed. Provider errors and secrets are not shown to visitors.
{ status: 'failed' }
```

Long conversions should be submitted as remote jobs; `start` and `poll` must finish within the 15-second adapter timeout and honor the supplied abort signal. Do not run GPU reconstruction inside the Worker or keep one HTTP request open for the full reconstruction. Keep provider credentials in server secrets and never embed them in model URLs or metadata. Pending jobs are polled at most once per three seconds on the server; the browser shows a stage animation, polls for up to twenty minutes, and then offers a manual status check.

The GLB must be self-contained glTF 2.0 with embedded resources, no external resource URLs, and no more than 25 MiB. It must contain usable geometry in meters, Y up, with its base at Y=0 and its X/Z footprint centered. Returned dimensions describe the actual exported geometry. The existing viewer checks the model bounds before enabling AR; the cache does not stretch a model to hide incorrect scale. Listing dimensions remain separately labeled.

One generated model is associated only with its requested ASIN and finish. Do not reuse it for sibling colors or sizes merely because they share a parent listing. Other finishes need their own generated assets or explicitly verified material mappings.

Change the adapter version when connecting or replacing the converter so an earlier disabled placeholder result does not prevent generation. Existing successful models remain reusable; changing the generator version is not an instruction to silently regenerate all existing assets.
