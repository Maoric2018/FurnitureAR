# Connect the Amazon importer

The product preview and multi-item layout editor support selected finishes, including dedicated models and named-material color overrides. Your service turns a product URL into the product below. Without the endpoint, every valid HTTP/HTTPS link uses the demo Little Tree table and its approximate color palette; the original link is retained with each item.

## Local bridge to the existing Amazon API

Run the existing Amazon API separately, then configure `.env.local` and restart Vite:

```dotenv
VITE_PRODUCT_API_URL=/api/products/import
FURNITURE_API_BASE_URL=http://127.0.0.1:8787
```

If that backend requires bearer authentication, set `FURNITURE_API_AUTH_TOKEN` as a server-only environment value. The bridge sends it to the backend; it is never a public `VITE_` variable. The SerpAPI key belongs in the Amazon backend, not in this frontend or the browser.

The bridge accepts the frontend POST below, extracts the ASIN from an HTTPS `amazon.com`, `www.amazon.com`, or `m.amazon.com` product URL, and requests `GET /v1/products/{ASIN}` from the configured backend. Supported product paths are `/dp/{ASIN}`, `/gp/product/{ASIN}`, and `/gp/aw/d/{ASIN}`; short links are not supported by this bridge. The backend supplies normalized product details, complete dimensions in meters, color groups, and exact variant combinations. The adapter retains only unambiguous, available colors for the selected size/style and preserves their exact ASIN and product link. Preview RGB colors come from the registered palette, not from an assumption that a retailer color name specifies a measured RGB value.

The current model mapping covers these seven Little Tree round-table family entries:

| ASIN | Finish |
| --- | --- |
| `B0F2ML48Y6` | Oak |
| `B0D8P23H61` | Black |
| `B0D8P1SVLG` | Grey |
| `B0D8NSXYQ6` | Light Brown |
| `B0F2MJHXBC` | Rustic Brown |
| `B0DSZGP1HK` | White |
| `B0D8NQHBBH` | Brown |

Only this family has registered geometry and a material palette. Other products require an explicit mapping to their own correctly scaled model; the bridge returns an error instead of substituting the demo table. It does not claim all seven finishes are available on every live lookup. Returned dimensions still have to match the supplied model before AR is enabled.

This is **local Vite middleware**, mounted through `configureServer` and `configurePreviewServer`. `npm run build` produces static assets and does not package a running API. Static production hosting requires deploying equivalent middleware or setting `VITE_PRODUCT_API_URL` to a real deployed import endpoint. The separately running Amazon backend is required in both cases.

## Endpoint

To use a service that already returns the frontend contract directly, set `VITE_PRODUCT_API_URL=https://your-service.example/api/products/import` in `.env.local` and restart Vite (or rebuild for production). Leave it empty for demo mode. Set CORS on a cross-origin service to permit the app's origin. A Vite variable is public configuration, never a place for secrets. Handle credentials and Amazon access on your server.

Request:

```http
POST /api/products/import
Content-Type: application/json

{"url":"https://www.amazon.com/dp/PRODUCT_ID"}
```

Response (`200`, `Content-Type: application/json`):

```json
{
  "product": {
    "id": "amazon-product-id",
    "name": "Example lounge chair",
    "category": "Seating",
    "tagline": "A chair for your reading corner.",
    "description": "A description from your importer.",
    "material": "Upholstered fabric · wood legs",
    "background": "#e9ede5",
    "dimensions": { "width": 0.78, "height": 0.81, "depth": 0.82 },
    "variants": [
      {
        "id": "sage",
        "name": "Sage",
        "color": "#8c9b7d",
        "modelSrc": "https://your-assets.example/chair-sage.glb"
      }
    ]
  }
}
```

The optional `footprint` field accepts `"ellipse"` for round/oval furniture or `"rectangle"` (the default). It controls floor-plan rendering and room-boundary checks.

`category` must be `Seating`, `Tables`, `Lighting`, or `Storage`. Dimensions are numbers in **meters**, greater than zero, at most 20. Each variant needs a unique nonempty ID, nonempty name, six-digit hex color, and valid GLB URL. Optional `iosSrc` can point to a prebuilt USDZ. The UI accepts same-origin paths beginning with one `/` or HTTPS model URLs.

## Variant colors and product identity

A variant with its own `modelSrc` uses that asset’s supplied material appearance. The `color` field draws its UI swatch; it does not recolor every surface automatically. For an explicit solid-color preview on shared geometry, supply `materialOverrides` with exact, case-sensitive glTF material names:

```json
{
  "id": "B0DSZGP1HK",
  "name": "White",
  "color": "#eeeae2",
  "modelSrc": "/models/little-tree-oak-table.glb",
  "approximate": true,
  "asin": "B0DSZGP1HK",
  "productUrl": "https://www.amazon.com/dp/B0DSZGP1HK",
  "materialOverrides": [
    { "materialName": "Oak | original grain texture", "color": "#eeeae2" }
  ]
}
```

`materialOverrides`, `approximate`, `asin`, and `productUrl` are optional. Override colors must be six-digit hex values and each target name must be nonempty and unique within the variant. `approximate` is a boolean; set it to `true` for a color approximation rather than a verified alternate finish. An `asin`, when supplied, must be ten alphanumeric characters. A `productUrl`, when supplied, must be a valid HTTPS Amazon product link. Supply the exact variant’s identity when the backend establishes it; do not infer an ASIN from a color label. These fields do not make an approximate material preview color-accurate.

Overrides replace only the named materials’ base color and base-color texture. Normal, roughness, other textures, geometry, and dimensions remain intact. The viewer snapshots original colors and textures once per loaded model, so successive changes do not accumulate tint and choosing the original variant restores its original wood texture. An override naming a missing material fails visibly and blocks AR. Same-source finish changes preserve the viewer and camera.

For the supplied table, Oak retains the embedded original grain texture. Its other registered colors are labeled approximate solid previews. Dedicated, correctly textured GLBs are the preferred way to represent real alternate finish appearances when such assets are available.

Each product item stores its selected `variantId`; the first variant is only the initial/default choice or a fallback for an obsolete saved ID. Saving, adding to a room, duplicating, and reloading preserve the choice. Each placed copy can have its own finish, and room finish edits participate in Undo. The layout exporter loads each selected variant’s model and clones its materials per instance before applying overrides, so mixed finishes export together without changing neighboring pieces. Optional variant product links follow the selection without replacing the item’s original source URL.

## AR color behavior

WebXR single-product previews include live finish controls after placement. iPhone Quick Look cannot host the app’s controls: choose a finish in the app first, then open AR. To change the finish, return to the app and reopen Quick Look. Layout AR places the exported arrangement as one group; edit its per-piece finishes in the room editor before opening AR.

When runtime overrides are active, the viewer omits any supplied `iosSrc` and generates USDZ from the selected model materials. Removing the overridden base-color texture avoids Quick Look’s limitation with multiplying a tint onto a texture. A dedicated variant without overrides may use a matching prebuilt USDZ. Automated tests inspect actual GLB and USDZ color output; live WebXR tracking, in-session controls, and iPhone Quick Look have not been verified on a physical device.

## Model requirements

- glTF 2.0 binary `.glb`; use PBR materials supported by model-viewer/Quick Look.
- Geometry uses **1 unit = 1 meter**, Y up, front +Z. Bake transformations into the export. The minimum Y is zero and the model is centered on X/Z.
- Actual model bounds must match the dimensions in your response. The viewer does not resize a real product to hide incorrect geometry.
- Keep assets small, preferably below 10 MB. Use self-contained textures; if hosting across origins, enable CORS so WebGL and the USDZ exporter can read them.
- Optional USDZ must represent the same finish and exact meter dimensions as its GLB; it is ignored while runtime material overrides are active.
- Do not return an image URL in `modelSrc`. Product photos need a separate 3D reconstruction pipeline and reliable physical dimensions first.
- Return non-2xx on failures. The local bridge allows 70 seconds for the backend, and the UI allows 75 seconds for the complete import. For the same-origin `/api/products/import` route, the UI displays a nonempty plain `error` string of at most 400 characters; malformed responses and external endpoint failures use a generic message. Error text is rendered as text, never interpreted as HTML.

The UI accepts arbitrary valid HTTP/HTTPS links, including links without a scheme (normalized to HTTPS). A configured backend must enforce the retailers it supports and return an appropriate error for others; the local bridge has the narrower Amazon URL rules above. Any short-link resolution and product fetches belong on the backend; restrict redirects and block internal network targets. The Amazon-specific validator also validates optional variant product links; the general link-entry flow retains its broader URL validation.

## Frontend connection point

`src/lib/products.ts` exports `importProduct(url, endpoint, signal)`, `parseProduct()`, `getVariant()`, and the product/variant types. `src/components/LinkInput.tsx` calls the importer only when the endpoint is configured. Both individual previews and room layouts use this component. `src/lib/workspace.ts` wraps the result with a unique item ID, original source link, and selected `variantId`; `selectItemVariant()` changes that selection without rearranging the product’s variants. `src/components/FinishPicker.tsx` presents choices, `src/lib/material-colors.ts` applies/restores named material colors, and `src/lib/layout-model.ts` exports each piece’s selected appearance. `server/amazon-import.ts` implements the local bridge and its limited model-family adapter.
