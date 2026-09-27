# Android implementation status

Date: 2026-09-27
Scope: the first offline-first source slice in src/android.

## Implemented in source

- One :app Kotlin/Compose project with a version catalog and pinned Android build versions.
- Room v1 tables for dataset metadata, schedules, global period configuration, courses, exams, and todos. Exported Room schema generation is enabled; the generated JSON still needs an SDK-equipped build.
- Preferences DataStore stores the active schedule UUID. Business reads and writes stay in Room.
- First-run term creation, multiple local schedules, schedule selection, week/day timetable, course editor, exam editor, todo list, and todo completion/deletion.
- Teaching-week calculation matches the desktop rule: week one is the Monday of the week containing the term start.
- Course overlap checks run again inside the write transaction, using weekday, inclusive period range, and intersecting teaching weeks.
- Exam save/update creates or updates the related todo in the same transaction. Exam deletion cascades to that todo; users cannot separately delete the exam-owned task.
- Opening the app reconciles exam todos whose exam end time has passed, using the exam's stored IANA time zone.
- JSON exchange v1 export/import via Storage Access Framework. Import previews counts, validates before mutation, supports merge or confirmed full replacement, and rolls back on duplicate-ID content conflicts.
- Unit tests cover the term-week and course-conflict rules. Android instrumentation tests cover exchange round-trip/unsupported records and exam-todo/course persistence invariants.

## Not implemented yet

- Structured recurring-task UI, occurrence de-duplication, and recurrence import/export.
- Reminder editing, notification channels/permissions, AlarmManager scheduling, boot/time-zone reconciliation.
- DeepSeek client, encrypted API key store, chat history, and proposal confirmation workflow.
- Glance widget, accessibility/device-size QA, release signing, and published APK/AAB.
- Desktop import/export adapter and cross-platform round-trip verification.
- Historical Room migration tests. The app is at its first schema, has no destructive fallback, and must gain versioned migrations as the schema evolves.

## Verification boundary

The current Windows environment has Java 21 but no Android Studio, Android SDK, adb, global Gradle, Gradle wrapper JAR, or Kotlin compiler. The Gradle module and source tests are present, but this handoff has not run assembleDebug, unit tests, or instrumentation tests, and has not produced an APK. The wrapper distribution properties target Gradle 8.13; the wrapper JAR/scripts and Room schema JSON must be generated/added from an SDK-equipped Android build host.

## Next implementation order

1. Provision the reproducible Gradle wrapper and Android SDK; build Debug, generate and commit the Room schema JSON, then run unit/instrumentation tests on an emulator.
2. Fix any toolchain/compiler issues found there before expanding features.
3. Add recurrence data/UI and notification scheduling with reboot, permission, and time-zone tests.
4. Add DeepSeek BYOK/key storage and explicitly confirmed AI actions.
5. Build the desktop exchange adapter and verify real desktop ↔ Android round trips before describing them as interoperable.
