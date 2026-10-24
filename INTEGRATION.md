# Connect the Amazon importer

The product preview and multi-item layout editor are ready. Your service turns a product URL into the product below. Without the endpoint, every valid HTTP/HTTPS link resolves to the same placeholder chair; the original link is retained with each item.

## Endpoint

Set `VITE_PRODUCT_API_URL=https://your-service.example/api/products/import` in `.env.local` and restart Vite (or rebuild for production). Leave it empty for demo mode. Set CORS on your service to permit the app's origin. A Vite variable is public configuration, never a place for secrets. Handle credentials and Amazon access on your server.

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

`category` must be `Seating`, `Tables`, `Lighting`, or `Storage`. Dimensions are numbers in **meters**, greater than zero, at most 20. Each variant needs a unique ID, name, six-digit hex color, and valid GLB URL. Optional `iosSrc` can point to a prebuilt USDZ. The UI accepts same-origin paths beginning with one `/` or HTTPS model URLs.

## Model requirements

- glTF 2.0 binary `.glb`; use PBR materials supported by model-viewer/Quick Look.
- Geometry uses **1 unit = 1 meter**, Y up, front +Z. Bake transformations into the export. The minimum Y is zero and the model is centered on X/Z.
- Actual model bounds must match the dimensions in your response. The viewer does not resize a real product to hide incorrect geometry.
- Keep assets small, preferably below 10 MB. Use self-contained textures; if hosting across origins, enable CORS so WebGL and the USDZ exporter can read them.
- Optional USDZ must represent the same finish and exact meter dimensions as its GLB.
- Do not return an image URL in `modelSrc`. Product photos need a separate 3D reconstruction pipeline and reliable physical dimensions first.
- Return non-2xx on failures. The UI handles errors, malformed responses and a 25-second timeout.

The UI now accepts arbitrary valid HTTP/HTTPS links, including links without a scheme (normalized to HTTPS). Your backend must enforce the retailers it supports and return an appropriate error for others. Short-link resolution and product fetches belong on your backend; restrict redirects and block internal network targets. The legacy Amazon-specific validator is retained for backend-adapter tests but is not used by the new link flow.

## Frontend connection point

`src/lib/products.ts` exports `importProduct(url, endpoint, signal)`, `parseProduct()`, and `FurnitureProduct`. `src/components/LinkInput.tsx` calls it only when the endpoint is configured. Both individual previews and room layouts use this component. `src/lib/workspace.ts` wraps the result with a unique item ID and source link. The current UI chooses the first returned variant; the layout exporter loads that same GLB. No other changes are required for the happy path.
