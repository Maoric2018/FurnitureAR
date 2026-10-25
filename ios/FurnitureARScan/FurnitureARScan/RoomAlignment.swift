import Foundation
import simd

struct PlanPoint: Codable { var x: Float; var z: Float }
struct PlanWall: Codable { var start: PlanPoint; var end: PlanPoint }
struct LayoutARPayload: Decodable {
    let version: Int
    let name: String
    let scanId: String?
    let walls: [PlanWall]
    let model: String
    func validate() throws -> Data {
        guard version == 1, !name.isEmpty, name.count <= 80,
              (scanId == nil || UUID(uuidString: scanId!) != nil),
              walls.count >= 2, walls.count <= 200,
              walls.allSatisfy({ wall in
                  [wall.start.x,wall.start.z,wall.end.x,wall.end.z].allSatisfy { $0.isFinite && abs($0) <= 100 }
                  && hypot(wall.end.x-wall.start.x,wall.end.z-wall.start.z) >= 0.02
              }), model.utf8.count <= 68_000_000,
              let data = Data(base64Encoded:model), data.count <= 48*1024*1024,
              data.prefix(4) == Data([0x50,0x4b,0x03,0x04]) else { throw AlignmentError.invalidLayout }
        return data
    }
}
enum AlignmentError: LocalizedError {
    case invalidLayout, shortWall, differentLength, differentHeight
    var errorDescription: String? {
        switch self {
        case .invalidLayout: return "This layout cannot be opened. Try fewer pieces or reopen the planner."
        case .shortWall: return "Choose two distinct floor corners at least half a metre apart."
        case .differentLength: return "Those points do not match this wall’s length. Choose the highlighted wall’s two floor corners again."
        case .differentHeight: return "Tap both corners where the wall meets the same floor."
        }
    }
}
/// Restore the editor's rigid floor-plan rotation and centering relative to the
/// trusted native scan. Never rescale or independently recenter the USDZ.
enum RoomAlignment {
    static func samePlan(_ a:[PlanWall],_ b:[PlanWall])->Bool {
        guard a.count == b.count else{return false}
        return zip(a,b).allSatisfy { first,second in
            abs(first.start.x-second.start.x)<0.02 && abs(first.start.z-second.start.z)<0.02 &&
            abs(first.end.x-second.end.x)<0.02 && abs(first.end.z-second.end.z)<0.02
        }
    }
    /// The importer keeps wall order/endpoints intact while rotating and centering.
    /// Fit one planar rotation/translation, then verify EVERY endpoint against the
    /// phone's saved scan. A different outline must use manual alignment instead.
    static func planTransform(from source:[PlanWall],to target:[PlanWall])->simd_float4x4? {
        guard source.count >= 2,source.count == target.count,source.count <= 200 else{return nil}
        let a=source.flatMap{[SIMD2($0.start.x,$0.start.z),SIMD2($0.end.x,$0.end.z)]}
        let b=target.flatMap{[SIMD2($0.start.x,$0.start.z),SIMD2($0.end.x,$0.end.z)]}
        guard (a+b).allSatisfy({$0.x.isFinite && $0.y.isFinite && abs($0.x)<=100 && abs($0.y)<=100}),
              (source+target).allSatisfy({hypot($0.end.x-$0.start.x,$0.end.z-$0.start.z)>=0.02}) else{return nil}
        let centerA=a.reduce(SIMD2<Float>.zero,+)/Float(a.count)
        let centerB=b.reduce(SIMD2<Float>.zero,+)/Float(b.count)
        var dot:Float=0,cross:Float=0,spreadA:Float=0,spreadB:Float=0
        for (first,second) in zip(a,b) {
            let p=first-centerA,q=second-centerB
            dot += simd_dot(p,q);cross += p.x*q.y-p.y*q.x
            spreadA=max(spreadA,simd_length(p));spreadB=max(spreadB,simd_length(q))
        }
        guard spreadA>=0.25,spreadB>=0.25,hypot(dot,cross)>0.000001 else{return nil}
        // SVG's positive X/Z rotation has the opposite sign from a +Y rotation.
        let yaw = -atan2(cross,dot)
        var result=simd_float4x4(simd_quatf(angle:yaw,axis:SIMD3(0,1,0)))
        let rotated=result*SIMD4(centerA.x,0,centerA.y,1)
        result.columns.3=SIMD4(centerB.x-rotated.x,0,centerB.y-rotated.z,1)
        guard zip(a,b).allSatisfy({p,q in
            let mapped=result*SIMD4(p.x,0,p.y,1)
            return simd_length(SIMD2(mapped.x,mapped.z)-q)<0.02
        }) else{return nil}
        return result
    }
    static func translation(x: Float, y: Float, z: Float) -> simd_float4x4 {
        var result = matrix_identity_float4x4
        result.columns.3 = SIMD4(x,y,z,1)
        return result
    }
    static func matching(wall: PlanWall, first: SIMD3<Float>, second: SIMD3<Float>) throws -> simd_float4x4 {
        let source = SIMD2(wall.end.x-wall.start.x,wall.end.z-wall.start.z)
        let target = SIMD2(second.x-first.x,second.z-first.z)
        guard [first.x,first.y,first.z,second.x,second.y,second.z,source.x,source.y].allSatisfy(\.isFinite),
              simd_length(source) >= 0.5, simd_length(target) >= 0.5 else { throw AlignmentError.shortWall }
        guard abs(first.y-second.y) <= 0.15 else { throw AlignmentError.differentHeight }
        guard abs(simd_length(source)-simd_length(target)) <= max(0.15,simd_length(source)*0.05) else { throw AlignmentError.differentLength }
        // A positive Y rotation sends +X toward -Z. SVG's rotation has the opposite sign.
        let yaw = atan2(source.y,source.x)-atan2(target.y,target.x)
        var result = simd_float4x4(simd_quatf(angle:yaw,axis:SIMD3(0,1,0)))
        let rotated = result * SIMD4(wall.start.x,0,wall.start.z,1)
        result.columns.3 = SIMD4(first.x-rotated.x,(first.y+second.y)/2,first.z-rotated.z,1)
        return result
    }
}
