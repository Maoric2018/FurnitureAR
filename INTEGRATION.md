# Amazon product import

The app uses the partner's SerpApi transport and normalizer through a same-origin server route. It supports US Amazon product URLs (`/dp/`, `/gp/product/`, `/gp/aw/d/`) and bare ASINs. Short links must first be expanded in a browser. Other stores and marketplaces return a clear error without being fetched.

## Run locally

1. `npm ci`
2. Copy `.dev.vars.example` to `.dev.vars` and set `SERPAPI_API_KEY`.
3. `npm run dev`
4. Open the printed localhost address. Amazon searches and imports work immediately as a guest; no sign-in is required.

`.dev.vars` is ignored by Git. Never put the API key in a `VITE_` variable. Hosted deployments use the Sites runtime secret named `SERPAPI_API_KEY`. The Cloudflare Vite plugin runs the same Worker entry point locally; the active importer does not require a separately running Amazon API.

`VITE_PRODUCT_API_URL` optionally overrides the default `/api/products/import` URL. An external endpoint must return the complete listing/product contract below and permit the app's origin through CORS. Vite variables are public configuration, never a place for secrets.

## Keyword search

`POST /api/products/search` with `Content-Type: application/json`:

```json
{"q":"floor lamp","page":1}
```

The server uses [SerpApi's Amazon Search API](https://serpapi.com/amazon-search-api), with `engine=amazon`, `k` for the keywords, and `amazon_domain=amazon.com`. Queries contain 2–200 characters after whitespace normalization. Pages are integers from 1 through 10. `VITE_PRODUCT_SEARCH_API_URL` optionally overrides this route independently of the product-import endpoint.

The response contains `query`, `page`, `nextPage`, `totalResults`, `products`, `retrievedAt`, `providerRetrievedAt`, and `cached`. Each product contains `asin`, `title`, a canonical Amazon `url`, nullable `imageUrl`, nullable `price` (`amount`, `currency`, and nullable `display`), nullable `rating`, nullable `ratingsTotal`, nullable `availability`, and `modelAvailable`.

Only supplied organic result entries with valid ASINs and titles become cards. Duplicate ASINs are removed; unsafe image links are discarded. Ratings, prices, stock, totals, and retrieval timestamps remain unknown when the provider omits them. `nextPage` is present only when the provider supplies a next-page link, and the app never fetches that URL directly. Results are paginated; there is no guarantee of exhaustive Amazon inventory or current stock.

`modelAvailable` means this app has a registered approximate model for that exact ASIN. The search response does not enumerate the generated-model cache. Selecting a card calls the product-import endpoint, which checks persistent model storage before looking up the full listing; search summaries alone cannot be placed in AR. Product previews open with photos, and browsing does not start generation or download a GLB. Products without a model still open their details and can be saved. Search and import allow anonymous requests and use the same server-only SerpApi key, same-origin JSON checks, request-size limits, caching, and credential-safe errors. There is no app-imposed per-user request quota for listing lookups. Each endpoint allows four simultaneous lookups per Worker instance to bound concurrent work.

## Request and response

`POST /api/products/import` with `Content-Type: application/json`:

```json
{"url":"https://www.amazon.com/dp/B0F2ML48Y6"}
```

This is a lookup only. It returns available listing/model metadata without starting or polling SAM 3D. To explicitly request generation, send:

```json
{"url":"https://www.amazon.com/dp/B0F2ML48Y6","generateModel":true}
```

`generateModel` is optional and must be a boolean when present; `false` is equivalent to omitting it. Existing ready models and pending attempts are reused. `GET /api/products/models/<ASIN>` checks an already accepted pending job and returns its current result without another Amazon lookup. GET never initiates generation for an unknown product or a terminal/unrequested record. Explicit retries get a new attempt identity only after a confirmed provider failure; ambiguous start timeouts retain the original identity to avoid duplicate GPU jobs.

The response contains `listing`, `product`, `model`, and `cached`. `listing` has the real title, brand, photo URLs, price (nullable), availability (nullable), feature text, raw listing dimensions, normalized dimensions (nullable), ASIN and retrieval timestamp. `product` is a validated FurnitureProduct with geometry dimensions and a model URL **only when a registered or completed generated model exists for the confirmed ASIN**; otherwise it is null. `model.status` can be `not_requested`, `pending`, `ready`, `failed`, `not_configured`, `no_image`, or `storage_unavailable`. A lookup with no existing model starts at `not_requested`; a pending lookup returns the recorded status without waiting on the provider. Older external adapters may omit `model`. See [MODEL_GENERATION.md](MODEL_GENERATION.md) for the durable cache and generator contract.

The UI can save and reopen listings without models. **Generate 3D model** saves the requested item and starts App-level tracking in the **3D models** panel. Closing the preview or opening another product does not cancel it. Active jobs persist in this browser, and reload resumes GET checks without replaying a generation POST. An accepted provider job continues after the tab closes; browser polling resumes when the app reopens. Ready products still show photos until the user chooses **Load 3D model**. Listings without models, and models without usable scale measurements, cannot enter a floor plan or launch AR. No unrelated placeholder is substituted. Previously saved placeholder products still reopen.

Errors use `{ "error": { "code": "...", "message": "..." } }`. The UI handles invalid URLs, unavailable products, provider failures, provider quota limits, and timeouts. Unexpected access errors describe a service problem rather than asking the visitor to sign in. A returned ASIN mismatch blocks model association. Secrets and raw upstream responses never go to the client.

For a modeled product, `category` must be `Seating`, `Tables`, `Lighting`, or `Storage`. Dimensions are numbers in **meters**, greater than zero, at most 20. Each variant needs a unique nonempty ID, nonempty name, six-digit hex color, and valid GLB URL. Optional `iosSrc` can point to a prebuilt USDZ. The UI accepts same-origin paths beginning with one `/` or HTTPS model URLs.

## Variant colors and product identity

The importer reads [SerpApi’s product variant groups and combinations](https://serpapi.com/amazon-product-api) and returns `listing.colors` for every product, including products without a model:

```json
{
  "status": "observed",
  "options": [
    { "asin": "B0F2ML48Y6", "name": "Oak", "url": "https://www.amazon.com/dp/B0F2ML48Y6", "imageUrl": null, "selected": true }
  ]
}
```

`status` is `observed` or `unconfirmed`. Unconfirmed data has an empty `options` array. Options have real ASINs, canonical links, and nullable safe HTTPS images; `selected` identifies the requested ASIN. Missing, ambiguous, or inconsistent identity information fails closed. Explicitly unavailable options are excluded, and combinations must match the current non-color dimensions, such as size and style. A reported option is evidence from the import snapshot, not a guarantee of current stock; both the app and provider cache may affect freshness.

The renderer supports dedicated models and named-material color overrides. The model registry still controls which reported options can be previewed: the Little Tree table maps recognized finishes to its authored palette, while the lamp currently has only its original Beige and Black model. A color label or product photo never invents an alternate model or RGB material. When data cannot be confirmed, the importer preserves the requested model’s appearance for viewing, but the UI does not offer unverified color choices.

`availableItemVariants()` intersects modeled variants with `listing.colors` by exact ASIN for every picker, including room editing and WebXR controls. `selectItemVariant()` enforces the same rule, and workspace loading preserves it. Old listings without `colors` remain readable but offer no unverified alternate colors; import the product again to update the saved snapshot. Authored sample products without an Amazon listing retain their explicitly labeled demo palette. Prices and stock from the original import are labeled as such after choosing another variant; its Amazon link follows the selected ASIN.

A variant with its own `modelSrc` uses that asset’s supplied material appearance. The `color` field draws its UI swatch; it does not recolor every surface automatically. For an explicit solid-color preview on shared geometry, supply `materialOverrides` with exact, case-sensitive glTF material names:

```json
{
  "id": "white-preview",
  "name": "White",
  "color": "#eeeae2",
  "modelSrc": "/models/little-tree-oak-table.glb",
  "approximate": true,
  "materialOverrides": [
    { "materialName": "Oak | original grain texture", "color": "#eeeae2" }
  ]
}
```

`materialOverrides`, `approximate`, `asin`, and `productUrl` are optional. Override colors must be six-digit hex values and each target name must be nonempty and unique within the variant. `approximate` is a boolean; set it to `true` for a color approximation rather than a verified alternate finish. An `asin`, when supplied, must be ten alphanumeric characters. A `productUrl`, when supplied, must be a valid HTTPS Amazon product link. Supply the exact variant’s identity when the backend establishes it; do not infer an ASIN from a color label. These fields do not make an approximate material preview color-accurate.

Overrides replace only the named materials’ base color and base-color texture. Normal, roughness, other textures, geometry, and dimensions remain intact. The viewer snapshots original colors and textures once per loaded model, so successive changes do not accumulate tint and choosing the original variant restores its original wood texture. An override naming a missing material fails visibly and blocks AR. Same-source finish changes preserve the viewer and camera.

The retained table sample palette has textured Oak plus approximate Black, Grey, Light Brown, Rustic Brown, White, and Brown solid-color previews. These are authored preview colors rather than measured RGB values from Amazon. Dedicated, correctly textured GLBs are preferred for faithful alternate appearances when available. Other product families need explicit model and material mappings before their live variants can drive this renderer; similarly named colors do not establish shared geometry.

Each modeled product item stores its selected `variantId`; the first variant is only the initial/default choice or a fallback for an obsolete saved ID. Saving, adding to a room, duplicating, and reloading preserve the choice. Each placed copy can have its own finish, and room finish edits participate in Undo. The layout exporter loads each selected variant’s model and clones its materials per instance before applying overrides, so mixed finishes export together without changing neighboring pieces. Optional variant product links follow the selection without replacing the item’s original source URL.

## AR color behavior

WebXR single-product previews include live finish controls for variants sharing the current model. Choose a variant with a different GLB before entering AR. iPhone Quick Look cannot host the app’s controls: choose a finish in the app first, then open AR. To change the finish, return to the app and reopen Quick Look. Layout AR places the exported arrangement as one group; edit its per-piece finishes in the room editor before opening AR.

When runtime overrides are active, the viewer omits any supplied `iosSrc` and generates USDZ from the selected model materials. Removing the overridden base-color texture avoids Quick Look’s limitation with multiplying a tint onto a texture. A dedicated variant without overrides may use a matching prebuilt USDZ. Automated tests inspect actual GLB and USDZ color output; live WebXR tracking, in-session controls, and iPhone Quick Look have not been verified on a physical device.

## Registered models

| ASIN | Asset | Scale |
| --- | --- | --- |
| B0F2ML48Y6 | Little Tree Oak | Approximately 1.20 × 1.20 × 0.75 m |
| B0D8P23H61 | Little Tree Black preview | Same table geometry |
| B0D8P1SVLG | Little Tree Grey preview | Same table geometry |
| B0D8NSXYQ6 | Little Tree Light Brown preview | Same table geometry |
| B0F2MJHXBC | Little Tree Rustic Brown preview | Same table geometry |
| B0DSZGP1HK | Little Tree White preview | Same table geometry |
| B0D8NQHBBH | Little Tree Brown preview | Same table geometry |
| B0C4DGFFCM | Ambimall floor lamp | 1.524 m tall; bounds include the cord |

Both assets are manually created approximations supplied by the project team. They are not Amazon-provided or SAM-generated. The lamp's root is translated to center its complete footprint on the floor; its geometry, textures and scale are retained.

Model bounds and listing measurements stay separate. In the live test, the lamp listing specified 61.8 inches while its model is 60 inches. The table included both labeled and unlabeled duplicate measurements. The integrated normalizer retains the explicit axes when the duplicate contains exactly the same three lengths. Ambiguous measurements alone, conflicting fields, and shipping dimensions remain unknown. No supplied asset is rescaled to hide a mismatch.

For new model mappings:

- Use glTF 2.0 binary `.glb` with PBR materials supported by model-viewer/Quick Look.
- Geometry uses **1 unit = 1 meter**, Y up, front +Z. Bake transformations into the export. Minimum Y is zero and the model is centered on X/Z.
- Actual model bounds must match the product geometry dimensions. The viewer does not resize a real product to hide incorrect geometry.
- Keep assets small, preferably below 10 MB. Use self-contained textures; cross-origin assets need CORS for WebGL and USDZ export.
- Optional USDZ must represent the same finish and exact meter dimensions as its GLB; it is ignored while runtime material overrides are active.
- Do not return an image URL in `modelSrc`. Product photos need a separate 3D reconstruction pipeline and reliable physical dimensions first.

## Request controls

Search and import require neither a signed-in user header nor a session cookie. Browser requests include same-origin Site cookies so owner-private hosting works; the product handlers still allow anonymous visitors on public Sites and do not receive provider credentials from the browser. There is a 4 KB body limit, strict host/ASIN validation, 60-second upstream timeout, and 65-second browser timeout. Search and uncached product-detail lookups retain a one-hour cache. Completed model records persist and bypass fresh Amazon lookups; pending generation retains its original listing snapshot. Each Worker instance coalesces requests by product and operation mode, shares concurrent listing lookups, and allows up to four distinct in-flight products. A concurrent lookup cannot consume an explicit generation request, and an independent lookup can return recorded pending status while a provider poll is in progress. The app does not impose per-user or shared guest quotas on listing lookups. SerpApi's own cache and subscription limits still apply; its private key remains in the server environment. Generation retains the existing provider queue/rate limits and one-worker GPU execution.

Sites' hosting audience is independent of these API routes. A public Site can serve anonymous visitors; an owner-private Site can still require sign-in before the app loads. Guest browsing on a hosted copy requires a public hosting audience as well as this version of the source.

SAM 3D generation uses the existing Runpod GPU through the server-only `MODEL_API_URL` and `MODEL_API_KEY`. Explicit Amazon generation requests use the start/poll adapter and persistent model cache; the camera studio uses a separate owner-bound upload gateway to the same service. Missing configuration returns `not_configured` when generation is requested; browsing an unrequested item remains `not_requested`. See [MODEL_GENERATION.md](MODEL_GENERATION.md) and [PHOTO_TO_3D.md](PHOTO_TO_3D.md).

## Code entry points

`src/lib/amazon.ts` validates live listings and separates lookup, explicit generation and status requests. `src/lib/model-jobs.ts` owns persistent background requests and recovery; `src/lib/use-model-jobs.ts` connects it to `src/App.tsx`, and `src/components/ModelJobsPanel.tsx` presents progress. `src/components/PreviewModal.tsx` offers photos-first viewing and loads the 3D viewer on demand. `src/lib/products.ts` validates modeled products and variants and exports `getVariant()`. `src/lib/workspace.ts` stores original links and selected `variantId`; `selectItemVariant()` changes the selection without rearranging variants. `src/components/FinishPicker.tsx` presents choices, `src/lib/material-colors.ts` applies and restores named material colors, and `src/lib/layout-model.ts` exports each piece’s selected appearance.

`server/amazon-import.js` associates confirmed ASINs with registered model data. `server/import-handler.js` handles guest requests, input limits, caching, and safe errors. `worker/index.ts` mounts the API and serves the app's assets. `server/external-amazon-bridge.ts`, the separate adapter for the earlier external Amazon backend, is not mounted by the active Vite or Worker configuration; it is not a substitute for the current listing/product response contract.
