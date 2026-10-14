# Tangent timetable exchange format v1

This file is the portable JSON boundary for manual data transfer. It is separate from the Room database schema and must not contain Android local row IDs, server IDs, credentials, AI history, device permissions, reminder queues, or local device preferences.

## Header and payload

~~~json
{
  "format": "tangent-timetable-exchange",
  "schemaVersion": 1,
  "sourceDatasetId": "stable UUID for the exporting dataset",
  "exportedAt": "2026-09-27T12:00:00Z",
  "minimumReaderVersion": "1.0.0",
  "payload": {
    "schedules": [],
    "periodConfigs": [],
    "courses": [],
    "exams": [],
    "todos": [],
    "recurringRules": [],
    "recurringOccurrences": [],
    "todoReminders": [],
    "examReminders": []
  }
}
~~~

All payload arrays are required, including arrays that are empty. Version 1 readers reject unknown or missing keys so a newer field cannot be silently discarded. sourceDatasetId identifies the exporting dataset and never replaces the receiving phone's own dataset identity.

## Records

- schedules: publicId, name, startDate, endDate, zoneId, revision, updatedAt.
- periodConfigs: periodNumber, startTime, endTime, label. periodNumber is the natural key.
- courses: publicId, schedulePublicId, name, teacher, location, colorHex, note, ISO dayOfWeek (1 Monday through 7 Sunday), startPeriod, endPeriod, integer weeks array, revision, updatedAt.
- exams: publicId, schedulePublicId, name, location, local ISO startAt / endAt, IANA zoneId, revision, updatedAt.
- todos: publicId, title, details, nullable local ISO dueAt, IANA zoneId, completed, nullable UTC completedAt, nullable examPublicId, revision, updatedAt.
- Recurrence and reminder record shapes will be added before those arrays may carry records. Current Android code emits empty arrays and rejects imported files where any of them are non-empty.

Every publicId is a stable UUID. Associations refer to those UUIDs, not local row IDs. updatedAt and completedAt use UTC RFC 3339 timestamps; term dates, local exam/todo times, and period times use ISO date/time text with the associated IANA time zone where applicable.

## Import behavior in the current Android slice

The SAF-selected file is read with a 10 MB limit and validated in memory before database writes. The reader checks format/version, exact keys, UUID uniqueness, date/time zones, references, period ranges, term-week bounds, and course conflicts. Any validation error rejects the whole file.

- Merge inserts new records, skips records whose publicId and complete portable value match, and rolls back the entire merge if an existing publicId has different content or a newly imported course conflicts with local courses.
- Full replacement requires a second confirmation, clears business data and restores the selected file in one Room transaction. Device dataset identity and API keys are never replaced.
- Imported exam todos keep their exam relationship. Export includes exam-created todos so the pair can round-trip.

This Android implementation currently supports schedules, periods, courses, exams, and todos. The desktop adapter is still separate work; until it is implemented and round-trip tested, this file format is not yet a claim of Android/desktop interoperability.
