import Foundation

/// Legacy optional fields are intentionally retained without imposing new DTO types.
public enum JSONValue: Codable, Sendable, Equatable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self), v.isFinite { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }

    public subscript(_ key: String) -> JSONValue? {
        guard case .object(let values) = self else { return nil }
        return values[key]
    }
    public var text: String? { if case .string(let v) = self { return v }; return nil }
    public var number: Double? { if case .number(let v) = self { return v }; return nil }
    public var items: [JSONValue]? { if case .array(let v) = self { return v }; return nil }
    public var fields: [String: JSONValue]? { if case .object(let v) = self { return v }; return nil }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}

public enum ClientError: Error, LocalizedError, Sendable, Equatable {
    case invalidData(String), missingEntry, stalePreview, conflict(String), unsupportedVersion
    case invalidNumber, cancelled, accountRequired

    public var errorDescription: String? {
        switch self {
        case .invalidData(let message): return "Invalid data: \(message)"
        case .missingEntry: return "The entry no longer exists."
        case .stalePreview: return "Vocabulary changed. Preview this import again."
        case .conflict(let message): return "Resolve this conflict before saving: \(message)"
        case .unsupportedVersion: return "This backup requires a newer application."
        case .invalidNumber: return "This count cannot be changed without losing numeric precision."
        case .cancelled: return "Import cancelled."
        case .accountRequired: return "This operation is limited to anonymous local vocabulary."
        }
    }
}
