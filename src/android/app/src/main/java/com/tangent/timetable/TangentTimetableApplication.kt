package com.tangent.timetable

import android.app.Application
import com.tangent.timetable.core.database.TimetableDatabase
import com.tangent.timetable.core.preferences.AppPreferencesRepository
import com.tangent.timetable.data.TimetableRepository

class TangentTimetableApplication : Application() {
    val database: TimetableDatabase by lazy { TimetableDatabase.getInstance(this) }
    val repository: TimetableRepository by lazy { TimetableRepository(database) }
    val preferences: AppPreferencesRepository by lazy { AppPreferencesRepository(this) }
}
