# Layout appearance checks

Start the development server, then open `/tests/browser/layout-textures.html`.
These checks run in a real browser because image decoding, canvas texture
embedding, and model-viewer rendering are not exercised by the Node tests.
They do not call Amazon or any model-generation service.

- **Run texture round-trip checks** loads the authored oak table, a black finish,
  the Ambimall lamp, a textured catalog chair, the Sunday Sofa in Moss, and a synthetic vertex-color
  fixture. Each goes through production `exportLayout`. Checks cover source and
  exported material factors, real decoded albedo pixels, normal-map references,
  GLB vertex-color values, and textures embedded in the browser's USDZ export.
  The vertex-color fixture must have a connected baked texture containing its
  red, blue, and green colors; an unused `displayColor` attribute is insufficient.
  Source and exported models render through the production `Viewer` component.
  Each rendered layout also calls model-viewer's actual automatic Quick Look
  conversion and verifies its material/shader targets remain under the active
  scene at `/Root/Scenes/Scene`, including the sofa's unnamed green fabric and wood materials.
  This checks the Vite exporter alias reaches the iPhone AR path. A download link
  for each automatic USDZ result enables native USD or physical-device checks.
- **Run texture fallback check** temporarily fails `createImageBitmap`, disables
  the Three.js image cache, and verifies the HTML-image fallback retains the oak
  texture pixels and maps. Browser globals are restored afterward.
- **Run complete decoder failure check** also makes HTML-image blob decoding
  fail. Export must stop with a useful error instead of returning white geometry.

`fixtures/vertex-colors.glb` is an authored, self-contained 1-meter cube standing
on the floor, with alternating red, blue, and green vertex colors. It is a test
fixture, not an Amazon product. It was exported using Three.js GLTFExporter from
BoxGeometry plus a `color` Float32BufferAttribute and a vertex-colored material.

The USDZ checks verify the generated files, shaders, and image bytes. They do
not verify native Quick Look display, camera tracking, or physical-device AR.

`npm test` also runs `tests/quick-look-model.test.ts`. On hosts with `usdcat` and
`usdchecker`, it imports both the exported USDZ's `/Root` and its active
`/Root/Scenes/Scene` into another USD stage
and verifies that mesh material bindings and surface shader connections survive.
This catches materials authored outside the imported subtree: such files can
contain the correct colors and textures and even pass `usdchecker --arkit`, yet
lose their materials when an AR consumer imports the asset. Archive alignment and
material-path checks run on every host; the native composition check is skipped
when those tools are unavailable.

The actual Sunday Sofa Moss GLB also goes through the saved-layout arrangement
and Quick Look export. Both native import paths must retain eleven bindings:
seven green upholstery pieces and four wood feet with the original color factors.

`tests/quick-look-vertex-colors.test.ts` independently decodes exported PNGs and
checks their UV-addressed corner and interpolated colors. It also covers a shared
material on differently colored geometries, atlas reuse, material tint, and
preservation of the original preview geometry and material.
