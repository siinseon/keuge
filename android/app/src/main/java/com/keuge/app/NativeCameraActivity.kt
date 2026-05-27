package com.keuge.app

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.keuge.app.databinding.ActivityNativeCameraBinding

class NativeCameraActivity : AppCompatActivity() {

    private lateinit var binding: ActivityNativeCameraBinding
    private lateinit var cameraManager: NativeCameraManager

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) cameraManager.start()
        else finishWithError("permission_denied")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityNativeCameraBinding.inflate(layoutInflater)
        setContentView(binding.root)

        cameraManager = NativeCameraManager(
            context = this,
            lifecycleOwner = this,
            previewView = binding.previewView,
            onResult = { success, text, error ->
                runOnUiThread {
                    setUiBusy(false)
                    val data = Intent().apply {
                        putExtra(EXTRA_SUCCESS, success)
                        if (!text.isNullOrBlank()) putExtra(EXTRA_TEXT, text)
                        if (!error.isNullOrBlank()) putExtra(EXTRA_ERROR, error)
                    }
                    setResult(RESULT_OK, data)
                    finish()
                }
            }
        )

        binding.cancelBtn.setOnClickListener {
            setResult(RESULT_CANCELED)
            finish()
        }

        binding.captureBtn.setOnClickListener {
            if (cameraManager.isBusy) return@setOnClickListener
            setUiBusy(true)
            cameraManager.captureAndOcr()
        }

        val hasPermission = ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED

        if (hasPermission) cameraManager.start()
        else permissionLauncher.launch(android.Manifest.permission.CAMERA)
    }

    private fun setUiBusy(busy: Boolean) {
        binding.progressBar.visibility = if (busy) View.VISIBLE else View.GONE
        binding.captureBtn.isEnabled = !busy
        binding.cancelBtn.isEnabled = !busy
        binding.captureBtn.text =
            if (busy) getString(R.string.camera_processing)
            else getString(R.string.camera_capture)
    }

    private fun finishWithError(code: String) {
        val data = Intent().apply {
            putExtra(EXTRA_SUCCESS, false)
            putExtra(EXTRA_ERROR, code)
        }
        setResult(RESULT_OK, data)
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraManager.shutdown()
    }

    companion object {
        const val EXTRA_SUCCESS = "success"
        const val EXTRA_TEXT = "text"
        const val EXTRA_ERROR = "error"

        fun createIntent(context: Context): Intent =
            Intent(context, NativeCameraActivity::class.java)
    }
}
