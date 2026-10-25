import Foundation

@main struct PlannerReturnChecks {
    static func main() throws {
        var checks = 0
        func equal(_ actual: String?, _ expected: String?) {
            precondition(actual == expected, "Expected \(String(describing: expected)), got \(String(describing: actual))")
            checks += 1
        }
        func rejects(_ action: () throws -> Void) {
            do { try action(); preconditionFailure("Expected an invalid destination to be rejected") }
            catch { checks += 1 }
        }
        func link(_ address: String) -> URL {
            var url = URLComponents(string: "furniturear-scan://scan")!
            url.queryItems = [URLQueryItem(name: "returnUrl", value: address)]
            return url.url!
        }
        let first = "https://first.example/app/"
        let second = "https://second.example:8443/planner/"
        equal(try PlannerReturn.launch(link(first), savedAddress: second)?.absoluteString, first)
        equal(try PlannerReturn.launch(link(second), savedAddress: first)?.absoluteString, second)
        equal(try PlannerReturn.launch(link("https://first.example/a%20room/"), savedAddress: "")?.absoluteString, "https://first.example/a%20room/")
        equal(try PlannerReturn.launch(URL(string: "furniturear-scan://scan")!, savedAddress: first)?.absoluteString, first)
        equal(try PlannerReturn.launch(URL(string: "furniturear-scan://scan")!, savedAddress: "")?.absoluteString, nil)
        equal(try PlannerReturn.capturedAddress(first, manualAddress: second).absoluteString, first)
        equal(try PlannerReturn.capturedAddress(nil, manualAddress: second).absoluteString, second)
        equal(try PlannerReturn.address("  https://FIRST.example/app/ \n").absoluteString, first)
        let prefix = "https://first.example/"
        let maximumAddress = prefix + String(repeating: "a", count: 4096 - prefix.count)
        equal(try PlannerReturn.launch(link(maximumAddress), savedAddress: second)?.absoluteString, maximumAddress)
        rejects { _ = try PlannerReturn.launch(link(maximumAddress + "a"), savedAddress: second) }
        for invalid in ["", "http://first.example/", "javascript:alert(1)", "file:///tmp/planner", "//first.example/", "https://user:pass@first.example/", "https://first.example/?token=private", "https://first.example/#room-scan=old", "https://first.example:0/", "https://first.example:65536/", "https://first.example/\\bad", "https://first.example/a room/"] {
            rejects { _ = try PlannerReturn.launch(link(invalid), savedAddress: first) }
        }
        for invalid in ["furniturear-scan://scan?returnUrl", "furniturear-scan://scan?returnUrl=", "furniturear-scan://scan?other=x", "furniturear-scan://scan?returnUrl=https%3A%2F%2Ffirst.example&returnUrl=https%3A%2F%2Fsecond.example", "furniturear-scan://scan/path?returnUrl=https%3A%2F%2Ffirst.example", "furniturear-scan://scan#fragment", "furniturear-scan://user@scan", "furniturear-scan://other", "https://scan"] {
            rejects { _ = try PlannerReturn.launch(URL(string: invalid)!, savedAddress: first) }
        }
        rejects { _ = try PlannerReturn.capturedAddress("http://invalid.example", manualAddress: first) }
        print("Planner return checks passed: \(checks)")
    }
}
