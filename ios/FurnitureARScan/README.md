# Furniture AR Scan

Native SwiftUI companion for the Furniture AR mobile website. Uses Apple's RoomPlan and LiDAR to capture wall sections, doors, windows, openings, and supported furniture categories. Your iPhone 16 Pro is supported. Requires iOS 17 or later; capture does not work in a browser or simulator.

## Install on your iPhone

1. Open `FurnitureARScan.xcodeproj` in Xcode on your Mac.
2. Select the **FurnitureARScan** target → **Signing & Capabilities**, enable automatic signing, and choose your Apple development team. A personal Apple account can be used for local development. Change the bundle identifier if Xcode requests a unique one.
3. Connect and unlock your iPhone, trust this Mac, and select the phone as the run destination. If prompted, enable Developer Mode in the phone's **Settings → Privacy & Security**, then follow the restart instructions.
4. Press **Run** in Xcode. If iOS requests developer trust, follow its Settings instructions. This is a development install, not an App Store release; Xcode will indicate any signing or renewal requirements.

## Scan → layout

1. Open the app and allow camera access. Choose **Scan my room**.
2. Slowly capture one room, including every wall, doorway, and piece of furniture. Follow the on-screen RoomPlan guidance, then choose **Finish scan**.
3. Review the outline and name the room. **Open in Furniture AR** opens the deployed website with a review screen. Confirm **Create layout from scan**.
4. Alternatively choose **Save / share room file**, then **Save to Files** or **AirDrop**. In the website choose **Import room scan** and select the exported JSON file. Large scans automatically use this file flow.
5. Existing objects appear as fixed, hatched footprints. They appear without detected category labels. Select one to correct its dimensions, position, or rotation; add missed furniture or remove a false detection. Add Amazon products and arrange around the existing objects. Collision and doorway warnings are estimates.

The web app keeps layouts in that browser's local storage; it does not sync rooms across devices. Import the file on each device where you want the room. AR previews contain new products only and require manual alignment with the real room. Scanning does not automatically establish an AR anchor for a later browser session.

## Data and geometry

Only measurements and category labels are exported. Camera images are not uploaded or included. The latest scan is saved locally with iOS file protection. Export files are generated in the app's temporary directory. The optional web handoff encodes JSON into a URL fragment (not an HTTP query); the web app removes it from the address after reading it. Use the file flow if you prefer not to include measurements in browser navigation history.

`RoomDocument.swift` defines the versioned `furniture-ar-room` JSON format. Coordinates are metres in RoomPlan's X/Z ground plane. Wall endpoints use each surface's local X axis, and furniture footprints use local X/Z dimensions plus rotation around the vertical axis. The web importer recentres every layer using one shared wall-bounds midpoint, without rescaling.

Imports are bounded to 512 KB, 200 entries per layer, and room bounds of 1–20 metres. Openings are cut out of matching wall sections; doorway clearance warnings use a 0.9 m deep approximation. Furniture collision uses oriented footprints, not full 3D geometry. Windows remain solid obstacles. RoomPlan can miss clutter, unusual shapes, glass, and unsupported objects. Review the scan and confirm important dimensions before relying on fit. Capture complete rooms: the UI does not edit wall geometry yet; rescan if the outline is incomplete.

## Checks

From the web repository root:

```sh
npm test
npm run build
xcodebuild -project ios/FurnitureARScan/FurnitureARScan.xcodeproj \
  -scheme FurnitureARScan -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/furniturear-scan-build CODE_SIGNING_ALLOWED=NO build
```

An unsigned build verifies compilation; installation and actual RoomPlan capture require a signed app on a physical LiDAR device. The web tests use `tests/fixtures/room-scan.json`, a synthetic QA room, not a captured room. The app exposes no sample scans to users.

The web handoff destination is in `RoomDocument.webURL()`. The `furniturear-scan://scan` URL opens capture after the companion app is installed.
