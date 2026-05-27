package com.keuge.app

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.keuge.app.databinding.ActivityNativeCameraBinding
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class NativeCameraActivity : AppCompatActivity() {

    private lateinit var binding: ActivityNativeCameraBinding
    private var imageCapture: ImageCapture? = null
    private lateinit var cameraExecutor: ExecutorService
    private var runOcr = true
    private var requestId: String = ""
    private var isProcessing = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) startCamera() else finishWithError("permission_denied")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityNativeCameraBinding.inflate(layoutInflater)
        setContentView(binding.root)

        requestId = intent.getStringExtra(EXTRA_REQUEST_ID).orEmpty()
        runOcr = intent.getBooleanExtra(EXTRA_RUN_OCR, true)
        cameraExecutor = Executors.newSingleThreadExecutor()

        binding.hintText.setText(
            if (runOcr) R.string.camera_hint_ocr else R.string.camera_hint_photo
        )

        binding.cancelBtn.setOnClickListener {
            setResult(RESULT_CANCELED)
            finish()
        }

        binding.captureBtn.setOnClickListener {
            if (isProcessing) return@setOnClickListener
            takePhoto()
        }

        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            permissionLauncher.launch(android.Manifest.permission.CAMERA)
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.surfaceProvider = binding.previewView.surfaceProvider
            }

            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .build()

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(
                    this,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    imageCapture
                )
            } catch (e: Exception) {
                finishWithError("camera_bind_failed")
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun takePhoto() {
        val capture = imageCapture ?: return
        isProcessing = true
        setUiBusy(true)

        val photoFile = File(cacheDir, "keuge_capture_${System.currentTimeMillis()}.jpg")
        val outputOptions = ImageCapture.OutputFileOptions.Builder(photoFile).build()

        capture.takePicture(
            outputOptions,
            cameraExecutor,
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    if (runOcr) {
                        processOcr(photoFile)
                    } else {
                        runOnUiThread {
                            finishWithSuccess("")
                        }
                    }
                }

                override fun onError(exception: ImageCaptureException) {
                    runOnUiThread {
                        finishWithError("capture_failed")
                    }
                }
            }
        )
    }

    private fun processOcr(photoFile: File) {
        cameraExecutor.execute {
            try {
                val bitmap = android.graphics.BitmapFactory.decodeFile(photoFile.absolutePath)
                    ?: throw IllegalArgumentException("invalid_image")
                val text = OcrProcessor.recognizeBitmap(bitmap)
                photoFile.delete()
                runOnUiThread {
                    if (text.isBlank()) {
                        finishWithError("empty_text")
                    } else {
                        finishWithSuccess(text)
                    }
                }
            } catch (e: Exception) {
                photoFile.delete()
                runOnUiThread {
                    finishWithError(e.message ?: "ocr_failed")
                }
            }
        }
    }

    private fun setUiBusy(busy: Boolean) {
        binding.progressBar.visibility = if (busy) View.VISIBLE else View.GONE
        binding.captureBtn.isEnabled = !busy
        binding.cancelBtn.isEnabled = !busy
        if (busy) {
            binding.captureBtn.text = getString(R.string.camera_processing)
        } else {
            binding.captureBtn.text = getString(R.string.camera_capture)
        }
    }

    private fun finishWithSuccess(text: String) {
        val data = Intent().apply {
            putExtra(EXTRA_SUCCESS, true)
            putExtra(EXTRA_TEXT, text)
        }
        setResult(RESULT_OK, data)
        finish()
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
        cameraExecutor.shutdown()
    }

    companion object {
        const val EXTRA_REQUEST_ID = "request_id"
        const val EXTRA_RUN_OCR = "run_ocr"
        const val EXTRA_SUCCESS = "success"
        const val EXTRA_TEXT = "text"
        const val EXTRA_ERROR = "error"

        fun createIntent(context: Context, requestId: String, runOcr: Boolean): Intent {
            return Intent(context, NativeCameraActivity::class.java).apply {
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_RUN_OCR, runOcr)
            }
        }
    }
}
