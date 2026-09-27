package com.tangent.timetable.core.preferences

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.timetablePreferences by preferencesDataStore(name = "timetable_preferences")

class AppPreferencesRepository(private val context: Context) {
    private val activeScheduleKey = stringPreferencesKey("active_schedule_public_id")

    val activeSchedulePublicId: Flow<String?> = context.timetablePreferences.data
        .map { preferences -> preferences[activeScheduleKey] }

    suspend fun setActiveSchedule(publicId: String) {
        context.timetablePreferences.edit { preferences ->
            preferences[activeScheduleKey] = publicId
        }
    }
}
