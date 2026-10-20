package com.kexu.timetable

import android.app.Application
import com.kexu.timetable.core.database.TimetableDatabase
import com.kexu.timetable.core.preferences.AppPreferencesRepository
import com.kexu.timetable.data.TimetableRepository

class KexuApplication : Application() {
    val database: TimetableDatabase by lazy { TimetableDatabase.getInstance(this) }
    val repository: TimetableRepository by lazy { TimetableRepository(database) }
    val preferences: AppPreferencesRepository by lazy { AppPreferencesRepository(this) }
}
