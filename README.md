# Furniture AR

A mobile-first furniture preview app built for a hackathon. Browse six original furniture models in eighteen finishes, inspect them in 3D, switch centimeters/inches, save a shortlist on your device, and place a piece in your room at its modeled size.

## Run locally

Requires Node.js 22.12+ (or a supported newer version).

```sh
npm install
npm run dev
```

Open the printed localhost URL. For a production build:

```sh
npm run build
npm run preview
```

## Try AR on a phone

1. Open the deployed **HTTPS** site in Safari on iPhone, or Chrome on an ARCore-compatible Android phone. The initial Sites deployment is private; sign in as the owner to access it.
2. Select a sample and a finish, then tap **View in your room**.
3. Allow camera access if asked. Slowly move the phone over a well-lit floor, then position the piece. Drag to move and use two fingers to rotate.
4. Scaling is locked to the model's actual meter dimensions. Use a tape measure before buying: phone tracking is an approximation.

The app uses Google's [`<model-viewer>`](https://modelviewer.dev/docs/index.html) with WebXR on supported Android browsers and Apple's Quick Look on iOS. Quick Look generates a USDZ from the selected GLB on demand. Desktop and unsupported phones retain the interactive 3D preview and receive phone guidance. AR requires a physical compatible phone and a secure origin; opening the dev server's plain HTTP network address on your phone will not enable WebXR. Test on the HTTPS deployment. Native camera tracking has to be verified on a real device.

We intentionally use `ar-modes="webxr quick-look"`. Both routes can use model data already loaded in the authenticated page. Android Scene Viewer is omitted because its external fetch cannot load models behind the initial private site's login. If you later enable Scene Viewer, its model URLs must be publicly fetchable over HTTPS, with appropriate CORS headers.

## Amazon integration handoff

Amazon import is an explicit placeholder until your friend's backend is ready. A valid Amazon link opens a sample chair with a prominent notice; it does **not** claim to recreate or scrape the linked product. No Amazon request is made in demo mode.

See [INTEGRATION.md](./INTEGRATION.md) for the exact endpoint contract and sample response. Set `VITE_PRODUCT_API_URL` in `.env.local`, then rebuild. This is a frontend app: implement that endpoint in your friend's service or a server deployment. Never put private API keys in frontend environment variables.

A product photo or Amazon URL alone is not enough for dimensionally accurate AR. The importer must supply a real 3D model scaled to verified product dimensions. Our six models are deliberately fictional samples.

## Project map

- `src/App.tsx`: browse/search, link flow, saved collection and guidance.
- `src/components/Viewer.tsx`: 3D rendering, device detection, AR activation, floor placement, fixed scale, load errors, and tracking events.
- `src/components/ProductDetail.tsx`: finish selection, dimensions and AR controls.
- `src/lib/products.ts`: data types, URL validation and backend adapter.
- `src/data/catalog.json`: sample furniture, dimensions in meters and finishes.
- `scripts/generate-models.mjs`: deterministic Three.js geometry generation.
- `public/models/`: self-contained GLBs; no third-party model-host dependency.
- `tests/products.test.ts`: importer contract, input validation, actual GLB geometry bounds, floor origin and USDZ export.

## Verification

```sh
npm test
npm run build
# Only when changing model construction or catalog dimensions:
npm run models
```

Models are built with baked dimensions in meters, centered at x/z=0, floor at y=0, facing +Z. AR scale never depends on CSS or a guessed unit conversion. The automated checks reload every GLB and inspect its actual bounding box.

## Scope and storage

- One furniture piece is placed per AR session. Cross-session room persistence and multi-item room layouts are not implemented.
- Favorites and preferred units are stored in this browser's local storage. There is no account/backend requirement for them and no cross-device sync.
- Camera access is handled by the browser/system AR viewer; this application has no camera upload or recording endpoint.
- This is an installable-style web experience with a manifest; it does not promise offline AR or include a service worker.
- All supplied sample 3D furniture geometry is original, generated for this project, and released under CC0-1.0. The interface and app code belong to this project. Package licenses apply to dependencies.
