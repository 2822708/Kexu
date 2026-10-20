# Kexu Android

Native Kotlin/Compose app for offline-first course schedules, exams, todos, and portable JSON exchange.

## Toolchain

- Android Studio with Android SDK Platform 36 and Build Tools 35.0.0 or newer.
- JDK 17 or newer. The project's Android bytecode target is Java 17.
- Android Gradle Plugin 8.13.2 with Gradle 8.13.
- Compose BOM 2026.03.00 (UI/Foundation 1.10.5, Material3 1.4.0), pinned for SDK 36 compatibility.
- Minimum Android API 26; target API 36.

On Windows, run **Setup-Android.cmd** in a normal terminal with network access. It installs pinned, checksum-verified Studio/SDK/Gradle packages, asks you to review SDK licenses, generates the official wrapper, and runs unit tests plus a Debug build. Use **Open-AndroidStudio.cmd**, **Open-AndroidTerminal.cmd**, **Build-Android.cmd**, and **Start-AndroidEmulator.cmd** afterwards. See the [Windows setup guide](../../docs/android/WINDOWS_DEVELOPMENT_ENVIRONMENT.md) for paths and options.

This Compose application is retained as a separate implementation; the current packaged local PWA uses `src/android-shell`. Use the installed Gradle 8.13 distribution if the local Gradle wrapper is absent. The selected Compose UI AAR declares minimum compile SDK 35 and AGP 8.6.0, compatible with this project's SDK 36 / AGP 8.13.2. Do not update the BOM independently to a release requiring a newer SDK or AGP. See the [official BOM mapping](https://developer.android.com/develop/ui/compose/bom/bom-mapping) and [Compose UI release notes](https://developer.android.com/jetpack/androidx/releases/compose-ui).

Validation on 2026-10-20 used JDK 21, Gradle 8.13 and SDK 36: `gradle --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest` passed. All five JVM unit tests passed, and both app and instrumentation APKs compiled. APK metadata reports application label `Kexu`, package `com.kexu.timetable.android`, minimum API 26 and target API 36. Instrumentation tests were compiled only; no device run is claimed. The generated Room version-1 schema is included under `app/schemas`.

## Current first slice

- First-run term setup, multiple schedules, schedule selection, and a persisted active schedule preference.
- Room / SQLite storage for schedules, periods, courses, exams, and todos; public UUIDs are separate from local row IDs.
- Week calculation anchored to Monday of the term-start week and in-transaction course conflict validation.
- Local course/exam/todo CRUD. Exam and generated todo are saved together; removing an exam cascades to its generated todo.
- On app entry, overdue exam-generated todos are reconciled against the stored exam time zone.
- SAF JSON exchange export, strict preview/validation, merge of identical public IDs, conflict rollback, and confirmed full replacement.
- Domain and Android instrumentation tests are included under app/src/test and app/src/androidTest.

The exchange importer currently rejects non-empty recurring-rule/reminder arrays rather than dropping them. See the exchange v1 and implementation status documents under docs/android.
