import Foundation

enum PlannerReturnError: LocalizedError {
    case invalidAddress, invalidLaunch
    var errorDescription: String? {
        switch self {
        case .invalidAddress: return "Use an HTTPS planner address without a sign-in token, query, or fragment. Open the scanner from the website to return there automatically."
        case .invalidLaunch: return "This scanner link has an invalid return address. Open the scanner again from the website you want to use."
        }
    }
}

/// Shared by deep-link imports, manually configured destinations, and legacy exports.
/// No deployment is a default: the launching website owns the return destination.
enum PlannerReturn {
    static func address(_ raw: String) throws -> URL {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 4096,
              value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              !value.contains("\\"),
              var parts = URLComponents(string: value),
              parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.port == nil || (1...65535).contains(parts.port!) else {
            throw PlannerReturnError.invalidAddress
        }
        parts.scheme = "https"
        parts.host = host.lowercased()
        guard let url = parts.url else { throw PlannerReturnError.invalidAddress }
        return url
    }

    /// A malformed explicit returnUrl never falls back to an old saved website.
    /// Bare legacy links continue to support the manually configured address.
    static func launch(_ url: URL, savedAddress: String) throws -> URL? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "furniturear-scan", parts.host?.lowercased() == "scan",
              parts.user == nil, parts.password == nil, parts.port == nil,
              (parts.path.isEmpty || parts.path == "/"), parts.fragment == nil else {
            throw PlannerReturnError.invalidLaunch
        }
        guard parts.query != nil else {
            return savedAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : try address(savedAddress)
        }
        guard let items = parts.queryItems, items.count == 1,
              items[0].name == "returnUrl", let value = items[0].value else {
            throw PlannerReturnError.invalidLaunch
        }
        do { return try address(value) }
        catch { throw PlannerReturnError.invalidLaunch }
    }

    /// A completed scan keeps its destination even when later scans/settings change.
    static func capturedAddress(_ captured: String?, manualAddress: String) throws -> URL {
        try address(captured ?? manualAddress)
    }
}
