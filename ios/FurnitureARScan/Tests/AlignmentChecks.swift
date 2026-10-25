import Foundation
import simd

@main struct AlignmentChecks {
    static func near(_ a:SIMD4<Float>,_ b:SIMD4<Float>){precondition(simd_length(a-b)<0.0001,"Transform mismatch: \(a) / \(b)")}
    static func rejects(_ block:()throws->Void){do{try block();fatalError("Expected rejection")}catch{}}
    static func transform(_ walls:[PlanWall],_ matrix:simd_float4x4)->[PlanWall] {
        func point(_ p:PlanPoint)->PlanPoint {let q=matrix*SIMD4(p.x,0,p.z,1);return PlanPoint(x:q.x,z:q.z)}
        return walls.map{PlanWall(start:point($0.start),end:point($0.end))}
    }
    static func main() throws {
        let wall=PlanWall(start:PlanPoint(x:-2,z:-1),end:PlanPoint(x:2,z:-1))
        let aligned=try RoomAlignment.matching(wall:wall,first:SIMD3(8,-1.2,19),second:SIMD3(12,-1.2,19))
        near(aligned*SIMD4(-2,0,-1,1),SIMD4(8,-1.2,19,1))
        near(aligned*SIMD4(2,0,-1,1),SIMD4(12,-1.2,19,1))
        near(aligned*SIMD4(0,0,0,1),SIMD4(10,-1.2,20,1))
        let rotated=try RoomAlignment.matching(wall:wall,first:SIMD3(10,0.4,18),second:SIMD3(10,0.4,22))
        near(rotated*SIMD4(-2,0,-1,1),SIMD4(10,0.4,18,1))
        near(rotated*SIMD4(2,0,-1,1),SIMD4(10,0.4,22,1))
        precondition(abs(simd_determinant(rotated)-1)<0.0001,"Alignment must never rescale furniture")
        let reversed=try RoomAlignment.matching(wall:wall,first:SIMD3(12,0,19),second:SIMD3(8,0,19))
        near(reversed*SIMD4(-2,0,-1,1),SIMD4(12,0,19,1));near(reversed*SIMD4(2,0,-1,1),SIMD4(8,0,19,1))
        near(RoomAlignment.translation(x:10.5,y:-1.6,z:20)*SIMD4(-1.1,0,-1.35,1),SIMD4(9.4,-1.6,18.65,1))
        rejects{_ = try RoomAlignment.matching(wall:wall,first:.zero,second:.zero)}
        rejects{_ = try RoomAlignment.matching(wall:wall,first:.zero,second:SIMD3(7,0,0))}
        rejects{_ = try RoomAlignment.matching(wall:wall,first:.zero,second:SIMD3(4,0.8,0))}
        rejects{_ = try RoomAlignment.matching(wall:wall,first:SIMD3(.nan,0,0),second:SIMD3(4,0,0))}
        precondition(RoomAlignment.samePlan([wall],[wall]));precondition(!RoomAlignment.samePlan([wall],[]))
        precondition(!RoomAlignment.samePlan([wall],[PlanWall(start:PlanPoint(x:-1,z:-1),end:wall.end)]))
        let room=[wall,
            PlanWall(start:wall.end,end:PlanPoint(x:2,z:2)),
            PlanWall(start:PlanPoint(x:2,z:2),end:PlanPoint(x:-2,z:2)),
            PlanWall(start:PlanPoint(x:-2,z:2),end:wall.start)]
        let unchanged=RoomAlignment.planTransform(from:room,to:room)!
        near(unchanged*SIMD4(1,0,1,1),SIMD4(1,0,1,1))
        let origin=RoomAlignment.translation(x:10.5,y:-1.6,z:20)
        for angle in [Float(-0.7),0.7,.pi/4,.pi/2,.pi] {
            let rotation=simd_float4x4(simd_quatf(angle:angle,axis:SIMD3(0,1,0)))
            let scanToEditor=RoomAlignment.translation(x:0.8,y:0,z:-0.35)*rotation
            let editor=transform(room,scanToEditor)
            let editorToScan=RoomAlignment.planTransform(from:editor,to:room)!
            for (web,native) in zip(editor,room) {
                near(editorToScan*SIMD4(web.start.x,0,web.start.z,1),SIMD4(native.start.x,0,native.start.z,1))
                near(editorToScan*SIMD4(web.end.x,0,web.end.z,1),SIMD4(native.end.x,0,native.end.z,1))
            }
            // Furniture positions and orientations use the same transform as walls.
            let chair=SIMD4<Float>(-1.1,0,-0.8,1),forward=SIMD4<Float>(1,0,0,0)
            near(origin*editorToScan*scanToEditor*chair,origin*chair)
            near(editorToScan*scanToEditor*forward,forward)
            precondition(abs(simd_determinant(editorToScan)-1)<0.0001,"Plan matching must not rescale or mirror")
        }
        var altered=room;altered[2].end.x += 0.15
        precondition(RoomAlignment.planTransform(from:altered,to:room)==nil,"Changed outlines must not restore tracking")
        var scaled=matrix_identity_float4x4;scaled.columns.0.x=1.2;scaled.columns.2.z=1.2
        precondition(RoomAlignment.planTransform(from:transform(room,scaled),to:room)==nil,"Scaling is not a rigid import")
        var reflected=matrix_identity_float4x4;reflected.columns.0.x = -1
        precondition(RoomAlignment.planTransform(from:transform(room,reflected),to:room)==nil,"Mirrored geometry must not match")
        var nonfinite=room;nonfinite[1].end.z = .nan
        precondition(RoomAlignment.planTransform(from:nonfinite,to:room)==nil)
        let degenerate=PlanWall(start:PlanPoint(x:0,z:0),end:PlanPoint(x:0,z:0))
        precondition(RoomAlignment.planTransform(from:[degenerate,degenerate],to:[degenerate,degenerate])==nil)
        precondition(RoomAlignment.planTransform(from:room,to:Array(room.dropLast()))==nil)
        precondition(RoomAlignment.planTransform(from:[],to:[])==nil)
        // A fragmented first wall cannot determine orientation reliably by itself.
        let fragmented=[PlanWall(start:wall.start,end:PlanPoint(x:-1.97,z:-1))]+room
        near(RoomAlignment.planTransform(from:fragmented,to:fragmented)!*SIMD4(1,0,1,1),SIMD4(1,0,1,1))
        let valid=LayoutARPayload(version:1,name:"Test",scanId:nil,walls:[wall,wall],model:Data([0x50,0x4b,0x03,0x04]).base64EncodedString())
        let validated=try valid.validate();precondition(validated.count == 4)
        rejects{_ = try LayoutARPayload(version:1,name:"Test",scanId:"../../room",walls:[wall,wall],model:valid.model).validate()}
        rejects{_ = try LayoutARPayload(version:1,name:"Test",scanId:nil,walls:[wall,wall],model:"not a model").validate()}
        print("Native alignment checks passed: room-origin restoration, axis-aligned scan mapping, translated/rotated endpoint and furniture preservation, fixed scale, mirrored/altered/degenerate/nonfinite plan rejection, manual alignment, payload validation.")
    }
}
