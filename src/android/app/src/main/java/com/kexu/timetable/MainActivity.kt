package com.kexu.timetable

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.kexu.timetable.feature.home.TimetableApp
import com.kexu.timetable.ui.theme.KexuTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels {
        val app = application as KexuApplication
        MainViewModel.factory(app.repository, app.preferences)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KexuTheme {
                TimetableApp(viewModel)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        viewModel.reconcilePastExamTodos()
    }
}
