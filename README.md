# Furniture AR

A mobile web app with two ways to plan furniture:

- **One product:** paste a link, inspect its 3D model, preview it in AR, and save it or add it to a room.
- **A whole room:** create a named layout, add multiple links, move and rotate pieces on a floor plan, then view the complete arrangement in 3D or AR.

The home screen is a workspace. Paste an **Amazon.com product link** to import its real name, photos, price, and available measurements. The table and lamp supplied by the project team have approximate 3D previews. Other products can be saved with their details; AR and room placement remain unavailable until a matching model exists. No unrelated placeholder is substituted.

## Run

Requires Node.js 22.12+ (or a supported newer version).

```sh
npm ci
cp .dev.vars.example .dev.vars
# Add the supplied SerpApi key to .dev.vars (server-only).
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

## Room layouts

Layouts save automatically in this browser, including names, room dimensions, source links, product metadata, positions, and rotations. Create, reopen, rename, duplicate, or delete layouts. Deletion offers Undo. Editing supports undo, pointer/touch dragging, arrow-key nudges (Shift for larger steps), and R to rotate. Selected pieces also have position sliders, rotation, duplicate, and remove controls. Room dimensions can be changed after creation.

A room supports up to 30 pieces. Floor-plan units are meters. The editor keeps rotated footprints within room bounds when the item fits. The layout is a planning surface, not a scan of the physical room: enter its dimensions yourself. Real AR alignment is performed on the phone.

Saved individual products form a separate library and can be reused across layouts. Persistence is **local to the current browser/device**, with no cross-device or account sync. Existing v1 favorites remain untouched in their original storage key; the new workspace uses `furniture-ar:workspace:v2`.

## AR

Open the HTTPS deployment in Safari on iPhone or Chrome on an ARCore-compatible Android phone. Product import requires ChatGPT sign-in on the hosted site. The local preview uses the Sites development sign-in. A plain HTTP LAN development URL will not enable WebXR.

- Single products use their GLB at actual scale.
- Layouts load their constituent models and export one combined GLB, preserving positions and rotations in meters. Its floor stays at y=0.
- The phone places the **whole arrangement as one group**. Edit relative positions in the floor plan, then reopen AR. Individual object movement inside the AR session and scanned-room persistence are not implemented.
- `<model-viewer>` uses WebXR and iOS Quick Look (USDZ generated on demand). Scene Viewer is omitted because external model fetches cannot access a private site's authenticated assets.
- AR scale is locked. The app checks GLB bounds against product dimensions before enabling AR. For layouts it validates each constituent model too.
- A compatible physical phone is required to verify camera tracking. AR is a visual guide; confirm purchase-critical measurements with a tape measure.

## Current table model

`public/models/little-tree-oak-table.glb` is the user-supplied file, preserved without rescaling or changing its textures. Its embedded metadata specifies a 1.199896 m diameter and 0.750062 m height (displayed as 120 × 120 × 75 cm). Geometry is centered on X/Z with its base at Y=0. The model describes itself as a photo-based reconstruction: overall dimensions follow the listing, with some hidden construction details estimated. These measurements come from the supplied file, not a new independent product verification.

Amazon ASIN B0F2ML48Y6 uses this table. ASIN B0C4DGFFCM uses the supplied Ambimall lamp. Previously saved products retain their original models. Round furniture uses an elliptical footprint in the floor plan and in room-boundary checks.

## Amazon importer

The partner’s SerpApi implementation is integrated into `POST /api/products/import`. See [INTEGRATION.md](./INTEGRATION.md) for setup, request/response details, supported links, limitations and model provenance. The API key is a server secret; it is never bundled into the phone app.

The current prototype selects the first registered model variant. Geometry dimensions and Amazon listing dimensions are displayed separately. SAM 3D generation remains a separate local trial and is not connected to live imports yet.

## Source map

- `src/App.tsx`: workspace overview, layouts, saved library, creation and navigation.
- `src/components/LinkInput.tsx`: universal product-link entry and importer connection.
- `src/components/PreviewModal.tsx`: individual product/AR preview.
- `src/components/RoomEditor.tsx`: arrangement editing and undo.
- `src/components/FloorPlan.tsx`: dimensioned SVG plan with touch, pointer and keyboard controls.
- `src/components/LayoutViewer.tsx`: whole-layout 3D/AR preview and temporary asset lifecycle.
- `src/lib/layout-model.ts`: model loading, geometry checks and combined scene export.
- `src/lib/workspace.ts`: workspace types, validation, persistence and layout operations.
- `src/components/Viewer.tsx`: fixed-scale AR activation, tracking, errors and capability fallback.
- `src/lib/products.ts`: model schema and geometry dimension validation.
- `src/lib/amazon.ts`: live listing validation and import request.
- `server/`: adapted partner transport, normalizer, importer, caching and access checks.
- `worker/index.ts`: hosted API route and static asset serving.
- `tests/`: model dimensions, importer contract, input validation, layout persistence and combined-scene transforms/USDZ export.

Original furniture GLBs are retained as development fixtures; the UI exposes only the one placeholder model. They can be regenerated with `npm run models`.

## Credits

The room photograph is from [Unsplash](https://images.unsplash.com/photo-1600210492486-724fe5c67fb0), downloaded as a local UI asset. It illustrates the room-planning entry point and is not a saved user layout. The original procedural fixture geometry is CC0-1.0; this does not apply to the separately supplied Little Tree table. Package licenses apply to dependencies. AR support uses Google's [model-viewer](https://modelviewer.dev/docs/index.html).
