# TangentTimetable Android

Native Kotlin/Compose app for offline-first course schedules, exams, todos, and portable JSON exchange.

## Toolchain

- Android Studio with Android SDK Platform 36 and Build Tools 35.0.0 or newer.
- JDK 17 or newer. The project's Android bytecode target is Java 17.
- Android Gradle Plugin 8.13.2 with Gradle 8.13.
- Minimum Android API 26; target API 36.

Open this directory as the Android Studio project root. If building from a command line, install Gradle 8.13 and run gradle :app:assembleDebug from this directory. The current handoff environment has no Android SDK, Android Studio, global Gradle installation, or Gradle wrapper bootstrap JAR, so it cannot produce or install an APK yet. Do not treat source presence as build verification. Add the Gradle wrapper scripts/JAR and generated Room schema JSON after the first SDK-equipped build.

## Current first slice

- First-run term setup, multiple schedules, schedule selection, and a persisted active schedule preference.
- Room / SQLite storage for schedules, periods, courses, exams, and todos; public UUIDs are separate from local row IDs.
- Week calculation anchored to Monday of the term-start week and in-transaction course conflict validation.
- Local course/exam/todo CRUD. Exam and generated todo are saved together; removing an exam cascades to its generated todo.
- On app entry, overdue exam-generated todos are reconciled against the stored exam time zone.
- SAF JSON exchange export, strict preview/validation, merge of identical public IDs, conflict rollback, and confirmed full replacement.
- Domain and Android instrumentation tests are included under app/src/test and app/src/androidTest.

The exchange importer currently rejects non-empty recurring-rule/reminder arrays rather than dropping them. See the exchange v1 and implementation status documents under docs/android.
