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
/// Website launches keep their own destination. Standalone and retired-site
/// scans use the current Roomify deployment instead of an obsolete saved URL.
enum PlannerReturn {
    static let currentAddress = "https://furniture-ar-mobile-20261024.notyourmewtwo.chatgpt.site/"
    private static let currentURL = URL(string: currentAddress)!
    private static let retiredHost = "furniture-ar-studio-eric.ericshengyanjin.chatgpt.site"

    private static func validatedAddress(_ raw: String) throws -> URL {
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

    private static func isRetired(_ url: URL) -> Bool {
        // A DNS trailing dot and case changes must not bypass this migration.
        // Exact host matching leaves other users' deployments untouched.
        guard var host = url.host?.lowercased() else { return false }
        if host.hasSuffix(".") { host.removeLast() }
        return host == retiredHost
    }

    static func address(_ raw: String) throws -> URL {
        let url = try validatedAddress(raw)
        return isRetired(url) ? currentURL : url
    }

    static func configuredAddress(_ raw: String) throws -> URL {
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return currentURL }
        return try address(raw)
    }

    /// A malformed explicit returnUrl never falls back to an old saved website.
    /// Bare legacy links use the configured address or current Roomify website.
    static func launch(_ url: URL, savedAddress: String) throws -> URL? {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              parts.scheme?.lowercased() == "furniturear-scan", parts.host?.lowercased() == "scan",
              parts.user == nil, parts.password == nil, parts.port == nil,
              (parts.path.isEmpty || parts.path == "/"), parts.fragment == nil else {
            throw PlannerReturnError.invalidLaunch
        }
        guard parts.query != nil else {
            return try configuredAddress(savedAddress)
        }
        guard let items = parts.queryItems, items.count == 1,
              items[0].name == "returnUrl", let value = items[0].value else {
            throw PlannerReturnError.invalidLaunch
        }
        do { return try address(value) }
        catch { throw PlannerReturnError.invalidLaunch }
    }

    /// Modern scans keep their destination. A retired destination must not
    /// override a corrected setting or keep reopening the old deployment.
    static func capturedAddress(_ captured: String?, manualAddress: String) throws -> URL {
        guard let captured, !captured.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return try configuredAddress(manualAddress)
        }
        let url = try validatedAddress(captured)
        if isRetired(url) { return try configuredAddress(manualAddress) }
        return url
    }
}
