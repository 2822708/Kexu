package com.tangent.timetable

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.tangent.timetable.feature.home.TimetableApp
import com.tangent.timetable.ui.theme.TangentTheme

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels {
        val app = application as TangentTimetableApplication
        MainViewModel.factory(app.repository, app.preferences)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            TangentTheme {
                TimetableApp(viewModel)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        viewModel.reconcilePastExamTodos()
    }
}
