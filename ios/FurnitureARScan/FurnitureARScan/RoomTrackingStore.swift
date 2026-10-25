import ARKit
import SwiftUI

@MainActor final class RoomTrackingStore: NSObject, ObservableObject, ARSessionDelegate {
    let session = ARSession()
    @Published var ready = false
    @Published var message = "Look around the room to restore its position."
    @Published var mapNotice: String?
    @Published var alignedOrigin: simd_float4x4?
    private(set) var liveScanId: String?
    private var expectedMarker: String?
    private var markerSeen = false
    private var restoring = false
    private var interrupted = false
    private var epoch = UUID()
    private var normalFrames = 0
    private var deadline: Task<Void,Never>?
    private let directory = URL.applicationSupportDirectory.appendingPathComponent("FurnitureARScan/rooms",isDirectory:true)

    override init() { super.init(); session.delegate = self }
    private func roomURL(_ id: String, _ ext: String) -> URL { directory.appendingPathComponent(id.lowercased()).appendingPathExtension(ext) }
    func document(_ id: String?) -> RoomDocument? {
        guard let id, UUID(uuidString:id) != nil, let data = try? Data(contentsOf:roomURL(id,"json")) else { return nil }
        return try? JSONDecoder().decode(RoomDocument.self,from:data)
    }
    func beginScan() {
        alignedOrigin=nil
        deadline?.cancel(); epoch = UUID(); liveScanId = nil; expectedMarker = nil; markerSeen = false; restoring = false; ready = false; normalFrames = 0; interrupted = false; mapNotice = nil
        let config = ARWorldTrackingConfiguration(); config.planeDetection = [.horizontal,.vertical]
        session.run(config,options:[.resetTracking,.removeExistingAnchors])
    }
    func completeScan(_ room: RoomDocument) {
        guard let id = room.scanId, let origin = room.floorPlanOrigin else { return }
        liveScanId = id; expectedMarker = "furniture-room-\(id.lowercased())"; markerSeen = true; restoring = false; normalFrames = 0
        alignedOrigin=origin
        session.delegate = self
        session.add(anchor:ARAnchor(name:expectedMarker!,transform:origin))
        do {
            try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
            try room.data().write(to:roomURL(id,"json"),options:[.atomic,.completeFileProtection])
        } catch { mapNotice = "This room could not be saved. Keep the app open, or use manual alignment later." }
        let token = epoch
        // Capture only a usable map. The live session remains useful if persistence fails.
        session.getCurrentWorldMap { [weak self] map, _ in
            Task { @MainActor in
                guard let self, self.epoch == token else { return }
                guard let map, !map.rawFeaturePoints.points.isEmpty,
                      let mapping=self.session.currentFrame?.worldMappingStatus,
                      mapping == .mapped || mapping == .extending else {
                    self.mapNotice = "The room map was not ready to save. This session stays aligned; returning later may need manual alignment."
                    return
                }
                do {
                    if !map.anchors.contains(where:{$0.name == self.expectedMarker}) {
                        map.anchors.append(ARAnchor(name:self.expectedMarker!,transform:origin))
                    }
                    let data = try NSKeyedArchiver.archivedData(withRootObject:map,requiringSecureCoding:true)
                    guard data.count < 64*1024*1024 else { self.mapNotice="This room map is too large to save. Manual alignment remains available.";return }
                    try data.write(to:self.roomURL(id,"armap"),options:[.atomic,.completeFileProtection])
                    self.mapNotice = nil
                } catch { self.mapNotice = "The tracking map could not be saved. Manual alignment will be available later." }
            }
        }
    }
    /// Return a trusted native transform only for the scan associated with this layout.
    func prepare(_ id: String?, walls:[PlanWall]) -> simd_float4x4? {
        deadline?.cancel(); session.delegate = self
        guard let room = document(id), let scanId = room.scanId, let transform = room.floorPlanOrigin,
              RoomAlignment.samePlan(walls,room.normalizedWalls) else {
            startManualSession(); message = "This room has no saved tracking map on this phone. Match a wall to align it."; return nil
        }
        if liveScanId == scanId && !interrupted && !restoring {
            expectedMarker = "furniture-room-\(scanId.lowercased())"; markerSeen = true
            message = ready ? "Aligned with your scan" : "Hold steady while room tracking resumes."
            return transform
        }
        guard let data = try? Data(contentsOf:roomURL(scanId,"armap")), data.count < 64*1024*1024,
              let map = try? NSKeyedUnarchiver.unarchivedObject(ofClass:ARWorldMap.self,from:data),
              map.anchors.contains(where:{$0.name == "furniture-room-\(scanId.lowercased())"}) else {
            startManualSession(); message = "No usable saved map. Match a wall to align this layout."; return nil
        }
        epoch = UUID(); ready = false; normalFrames = 0; markerSeen = false; restoring = true; interrupted = false; liveScanId = scanId
        alignedOrigin=nil
        expectedMarker = "furniture-room-\(scanId.lowercased())"
        message = "Recognizing your room… Slowly point at walls and furniture you scanned."
        let config = ARWorldTrackingConfiguration(); config.planeDetection = [.horizontal,.vertical]; config.initialWorldMap = map
        session.run(config,options:[.resetTracking,.removeExistingAnchors])
        deadline = Task { [weak self] in
            try? await Task.sleep(for:.seconds(25)); guard !Task.isCancelled,let self,!self.ready else { return }
            self.message = "Room not recognized yet. Look at the scanned area or choose Match a wall."
        }
        return transform
    }
    func startManualSession() {
        alignedOrigin=nil
        deadline?.cancel(); epoch = UUID(); liveScanId = nil; expectedMarker = nil; markerSeen = false; restoring = false; interrupted = false; ready = false; normalFrames = 0
        session.delegate = self
        let config = ARWorldTrackingConfiguration(); config.planeDetection = [.horizontal,.vertical]
        session.run(config,options:[.resetTracking,.removeExistingAnchors])
        message = "Move slowly to find the floor, then match the highlighted wall."
    }
    func suspend() {
        deadline?.cancel(); epoch = UUID(); ready = false; interrupted = true; normalFrames = 0
        session.pause(); message = "Tracking paused. Reopen the preview to recognize the room again."
    }
    nonisolated func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let normal: Bool; if case .normal = frame.camera.trackingState { normal = true } else { normal = false }
        Task { @MainActor [weak self] in
            guard let self,!self.interrupted else { return }
            if normal { self.normalFrames = min(self.normalFrames+1,10) } else { self.normalFrames = 0 }
            let usable = self.normalFrames >= 10 && (!self.restoring || self.markerSeen)
            if self.ready != usable { self.ready = usable }
            if usable {
                self.deadline?.cancel(); self.restoring = false
                let message = self.liveScanId == nil ? "Floor tracking ready" : "Aligned with your scan"
                if self.message != message { self.message=message }
            } else if !normal && !self.restoring {
                let message="Tracking is limited. Move slowly in good light; furniture is hidden until tracking recovers."
                if self.message != message { self.message=message }
            }
        }
    }
    nonisolated func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
        receive(anchors)
    }
    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { receive(anchors) }
    nonisolated private func receive(_ anchors:[ARAnchor]) {
        Task { @MainActor [weak self] in
            guard let self,let marker=self.expectedMarker,let anchor=anchors.first(where:{$0.name == marker}) else{return}
            self.alignedOrigin=anchor.transform;self.markerSeen=true
        }
    }
    nonisolated func sessionWasInterrupted(_ session: ARSession) { Task { @MainActor [weak self] in self?.ready=false;self?.normalFrames=0;self?.interrupted=true;self?.message="Camera interrupted. Reopen the preview to restore room alignment." } }
    nonisolated func sessionInterruptionEnded(_ session: ARSession) { Task { @MainActor [weak self] in self?.message="Reopen the preview to recognize this room again." } }
    nonisolated func session(_ session: ARSession, didFailWithError error: Error) { Task { @MainActor [weak self] in self?.ready=false;self?.interrupted=true;self?.message="Room tracking failed. Close this preview and try again." } }
}
