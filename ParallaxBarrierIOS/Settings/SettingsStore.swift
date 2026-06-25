import Foundation

final class SettingsStore {
    static let defaultKey = "app.settings.v1"

    private let defaults: UserDefaults
    private let key: String
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(defaults: UserDefaults = .standard, key: String = SettingsStore.defaultKey) {
        self.defaults = defaults
        self.key = key
        encoder.outputFormatting = [.sortedKeys]
    }

    func load() -> AppSettings {
        guard let data = defaults.data(forKey: key) else {
            return .standard
        }

        do {
            return try decoder.decode(AppSettings.self, from: data).validated()
        } catch {
            return .standard
        }
    }

    func save(_ settings: AppSettings) {
        let validated = settings.validated()
        guard let data = try? encoder.encode(validated) else { return }
        defaults.set(data, forKey: key)
    }

    @discardableResult
    func reset() -> AppSettings {
        defaults.removeObject(forKey: key)
        let defaults = AppSettings.standard
        save(defaults)
        return defaults
    }

    func corruptForTesting(_ data: Data) {
        defaults.set(data, forKey: key)
    }
}
