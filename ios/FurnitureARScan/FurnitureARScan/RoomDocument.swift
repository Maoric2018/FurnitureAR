import Foundation
import RoomPlan
import simd

struct ScanPoint: Codable { var x: Float; var z: Float }
struct ScanWall: Codable, Identifiable {
    var id: String; var start: ScanPoint; var end: ScanPoint
    var height: Float; var confidence: String
}
struct ScanOpening: Codable, Identifiable {
    var id: String; var start: ScanPoint; var end: ScanPoint
    var height: Float; var confidence: String; var kind: String
}
struct ScanObstacle: Codable, Identifiable {
    var id: String; var name: String; var category: String
    var x: Float; var z: Float; var width: Float; var depth: Float
    var height: Float; var rotation: Float; var confidence: String
}
struct RoomDocument: Codable {
    var format = "furniture-ar-room"
    var version = 1
    var units = "meters"
    var source = "apple-roomplan"
    var name: String
    var capturedAt: String
    var scanId: String?
    var floorY: Float?
    // Optional for compatibility with existing scans. Always revalidated before navigation.
    var plannerURL: String?
    var walls: [ScanWall]
    var openings: [ScanOpening]
    var obstacles: [ScanObstacle]

    init(room: CapturedRoom, name: String = "My scanned room") throws {
        self.name = name
        capturedAt = ISO8601DateFormatter().string(from: Date())
        scanId = UUID().uuidString
        let floorEstimates = room.walls.map { $0.transform.columns.3.y - $0.dimensions.y / 2 }.sorted()
        floorY = floorEstimates.isEmpty ? nil : floorEstimates[floorEstimates.count / 2]
        func confidence(_ value: CapturedRoom.Confidence) -> String {
            switch value { case .high: return "high"; case .medium: return "medium"; case .low: return "low"; @unknown default: return "unknown" }
        }
        func segment(_ surface: CapturedRoom.Surface) -> ScanWall {
            // RoomPlan's local X axis follows each wall. Project both endpoints
            // into the SAME world X/Z frame used by the furniture transforms.
            let center = surface.transform.columns.3
            let half = surface.transform.columns.0 * (surface.dimensions.x / 2)
            return ScanWall(id: surface.identifier.uuidString,
                start: ScanPoint(x: center.x-half.x, z: center.z-half.z),
                end: ScanPoint(x: center.x+half.x, z: center.z+half.z),
                height: surface.dimensions.y, confidence: confidence(surface.confidence))
        }
        walls = room.walls.map(segment)
        openings = [(room.doors,"door"),(room.windows,"window"),(room.openings,"opening")].flatMap { surfaces, kind in
            surfaces.map { surface in
                let wall = segment(surface)
                return ScanOpening(id: wall.id, start: wall.start, end: wall.end,
                    height: wall.height, confidence: wall.confidence, kind: kind)
            }
        }
        obstacles = room.objects.map { object in
            let category = String(describing: object.category)
            let position = object.transform.columns.3
            let axis = object.transform.columns.0
            // SVG uses X right / Z down. This is clockwise in the floor plan.
            let rotation = atan2(axis.z, axis.x) * 180 / .pi
            return ScanObstacle(id: object.identifier.uuidString,
                name: Self.displayName(category), category: category,
                x: position.x, z: position.z, width: object.dimensions.x,
                depth: object.dimensions.z, height: object.dimensions.y,
                rotation: rotation, confidence: confidence(object.confidence))
        }
        guard walls.count >= 2 else { throw ScanError.incomplete }
        let bounds = self.bounds
        guard bounds.width >= 1, bounds.depth >= 1, bounds.width <= 20, bounds.depth <= 20 else { throw ScanError.incomplete }
        guard walls.count <= 200, openings.count <= 200, obstacles.count <= 200 else { throw ScanError.tooLarge }
    }
    static func displayName(_ category: String) -> String {
        ["washerDryer":"Washer / dryer", "television":"TV", "storage":"Cabinet"][category] ?? category.prefix(1).uppercased() + category.dropFirst()
    }
    var bounds: (minX: Float, minZ: Float, width: Float, depth: Float) {
        let points = walls.flatMap { [$0.start,$0.end] }
        let xs = points.map(\.x), zs = points.map(\.z)
        let minX = xs.min() ?? 0, minZ = zs.min() ?? 0
        return (minX,minZ,(xs.max() ?? 0)-minX,(zs.max() ?? 0)-minZ)
    }
    var floorPlanOrigin: simd_float4x4? {
        guard let scanId, UUID(uuidString:scanId) != nil, let floorY, floorY.isFinite else { return nil }
        let b = bounds
        return RoomAlignment.translation(x:b.minX+b.width/2,y:floorY,z:b.minZ+b.depth/2)
    }
    var normalizedWalls:[PlanWall] {
        let b=bounds,cx=b.minX+b.width/2,cz=b.minZ+b.depth/2
        return walls.map{PlanWall(start:PlanPoint(x:$0.start.x-cx,z:$0.start.z-cz),end:PlanPoint(x:$0.end.x-cx,z:$0.end.z-cz))}
    }
    func data() throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
    func file() throws -> URL {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("FurnitureARScans", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("Room-\(UUID().uuidString.prefix(8)).json")
        try data().write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }
    func webURL(destination: URL) throws -> URL? {
        let target = try PlannerReturn.address(destination.absoluteString)
        let encoded = try data().base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        // Large scans use a file instead of a URL that a browser might truncate.
        guard encoded.count <= 12_000 else { return nil }
        var components = URLComponents(url: target, resolvingAgainstBaseURL: false)
        components?.fragment = "room-scan=\(encoded)"
        return components?.url
    }
}
enum ScanError: LocalizedError {
    case incomplete, tooLarge
    var errorDescription: String? {
        switch self {
        case .incomplete: return "Scan every wall of one room, including its corners. The complete outline must be between 1 and 20 metres across."
        case .tooLarge: return "This scan has too many surfaces. Try scanning one room at a time."
        }
    }
}
