import Foundation
import simd

@main struct AlignmentChecks {
    static func near(_ a:SIMD4<Float>,_ b:SIMD4<Float>){precondition(simd_length(a-b)<0.0001,"Transform mismatch: \(a) / \(b)")}
    static func rejects(_ block:()throws->Void){do{try block();fatalError("Expected rejection")}catch{}}
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
        let valid=LayoutARPayload(version:1,name:"Test",scanId:nil,walls:[wall,wall],model:Data([0x50,0x4b,0x03,0x04]).base64EncodedString())
        let validated=try valid.validate();precondition(validated.count == 4)
        rejects{_ = try LayoutARPayload(version:1,name:"Test",scanId:"../../room",walls:[wall,wall],model:valid.model).validate()}
        rejects{_ = try LayoutARPayload(version:1,name:"Test",scanId:nil,walls:[wall,wall],model:"not a model").validate()}
        print("Native alignment checks passed: room-origin restoration, translation, yaw, reversed wall, fixed scale, degenerate/height/length/nonfinite rejection, scan-plan match, payload validation.")
    }
}
