import Foundation

public enum ReminderPlan {
    public static func dates(after now: Date, hour: Int, minute: Int, timeZoneID: String, days: Int = 7) throws -> [Date] {
        guard (0...23).contains(hour), (0...59).contains(minute), (1...7).contains(days),
              let zone = TimeZone(identifier: timeZoneID) else { throw ClientError.invalidData("reminder time") }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        var result: [Date] = []
        let start = calendar.startOfDay(for: now)
        // DST gaps use the next valid time; repeated hours use their first occurrence.
        for offset in 0...days {
            guard let day = calendar.date(byAdding: .day, value: offset, to: start),
                  let date = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: day,
                    matchingPolicy: .nextTime, repeatedTimePolicy: .first, direction: .forward), date > now else { continue }
            result.append(date)
            if result.count == days { break }
        }
        return result
    }
}
