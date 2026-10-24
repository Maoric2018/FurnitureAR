# Amazon product import

The app uses the partner's SerpApi transport and normalizer through a same-origin server route. It supports US Amazon product URLs (`/dp/`, `/gp/product/`, `/gp/aw/d/`) and bare ASINs. Short links must first be expanded in a browser. Other stores and marketplaces return a clear error without being fetched.

## Run locally

1. `npm ci`
2. Copy `.dev.vars.example` to `.dev.vars` and set `SERPAPI_API_KEY`.
3. `npm run dev`
4. Open the printed localhost address. The local sign-in link uses the Sites development identity.

`.dev.vars` is ignored by Git. Never put the API key in a `VITE_` variable. Hosted deployments use the Sites runtime secret named `SERPAPI_API_KEY`. The Cloudflare Vite plugin runs the same Worker entry point locally; the active importer does not require a separately running Amazon API.

`VITE_PRODUCT_API_URL` optionally overrides the default `/api/products/import` URL. An external endpoint must return the complete listing/product contract below and permit the app's origin through CORS. Vite variables are public configuration, never a place for secrets.

## Request and response

`POST /api/products/import` with `Content-Type: application/json`:

```json
{"url":"https://www.amazon.com/dp/B0F2ML48Y6"}
```

The response contains `listing`, `product`, and `cached`. `listing` has the real title, brand, photo URLs, price (nullable), availability (nullable), feature text, raw listing dimensions, normalized dimensions (nullable), ASIN and retrieval timestamp. `product` is a validated FurnitureProduct with geometry dimensions and a model URL **only when a model is registered for the confirmed ASIN**; otherwise it is null.

The UI can save and reopen listings without models. Those listings cannot enter a floor plan or launch AR. No unrelated placeholder is substituted. Previously saved placeholder products still reopen.

Errors use `{ "error": { "code": "...", "message": "..." } }`. The UI handles sign-in, invalid URLs, unavailable products, provider failures, quota limits, and timeouts. A returned ASIN mismatch blocks model association. Secrets and raw upstream responses never go to the client.

For a modeled product, `category` must be `Seating`, `Tables`, `Lighting`, or `Storage`. Dimensions are numbers in **meters**, greater than zero, at most 20. Each variant needs a unique nonempty ID, nonempty name, six-digit hex color, and valid GLB URL. Optional `iosSrc` can point to a prebuilt USDZ. The UI accepts same-origin paths beginning with one `/` or HTTPS model URLs.

## Variant colors and product identity

The renderer supports dedicated models and named-material color overrides. The integrated SerpApi importer reads observed color options for the registered Little Tree table family and maps recognized finishes to the authored palette. It preserves confirmed variant ASINs and links and filters unavailable or ambiguous alternatives, including incompatible size/style combinations. If the color payload cannot be used, the importer retains the known finish for the requested ASIN while still returning the listing. It does not fabricate additional options or treat the entire palette as evidence of current availability. The lamp currently returns only its original Beige and Black model.

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

Imports require the trusted Sites signed-in user header. Browser POSTs must be same-origin JSON. There is a 4 KB body limit, strict host/ASIN validation, 60-second upstream timeout, and 65-second browser timeout. Each Worker instance caches successful results for one hour, coalesces simultaneous requests for the same ASIN, allows up to four different in-flight lookups, and limits uncached imports to eight per user per minute. These per-instance limits are prototype safeguards, not a durable account-wide billing cap. SerpApi's own cache remains enabled; live requests share the supplied account's allowance.

SAM 3D generation is a separate local experiment. This route does not yet generate new models from product photos.

## Code entry points

`src/lib/amazon.ts` validates live listings and calls the active import route. `src/lib/products.ts` validates modeled products and variants and exports `getVariant()`. `src/lib/workspace.ts` stores original links and selected `variantId`; `selectItemVariant()` changes the selection without rearranging variants. `src/components/FinishPicker.tsx` presents choices, `src/lib/material-colors.ts` applies and restores named material colors, and `src/lib/layout-model.ts` exports each piece’s selected appearance.

`server/amazon-import.js` associates confirmed ASINs with registered model data. `server/import-handler.js` handles authentication, request limits, caching, and safe errors. `worker/index.ts` mounts the API and serves the app's assets. `server/external-amazon-bridge.ts`, the separate adapter for the earlier external Amazon backend, is not mounted by the active Vite or Worker configuration; it is not a substitute for the current listing/product response contract.
