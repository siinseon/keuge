package com.keuge.app

import android.content.Context
import android.graphics.BitmapFactory
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

typealias OcrResultCallback = (success: Boolean, text: String?, error: String?) -> Unit

/**
 * CameraX 기반 카메라 미리보기 + 촬영 + ML Kit 한국어 OCR 관리자.
 * NativeCameraActivity 에서 생성하여 사용.
 */
class NativeCameraManager(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val previewView: PreviewView,
    private val onResult: OcrResultCallback
) {
    private var imageCapture: ImageCapture? = null
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()

    var isBusy = false
        private set

    fun start() {
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also {
                it.surfaceProvider = previewView.surfaceProvider
            }
            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .build()
            try {
                provider.unbindAll()
                provider.bindToLifecycle(
                    lifecycleOwner,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    imageCapture
                )
            } catch (e: Exception) {
                onResult(false, null, "camera_bind_failed")
            }
        }, ContextCompat.getMainExecutor(context))
    }

    fun captureAndOcr() {
        if (isBusy) return
        val capture = imageCapture ?: run {
            onResult(false, null, "camera_not_ready")
            return
        }
        isBusy = true

        val file = File(context.cacheDir, "keuge_${System.currentTimeMillis()}.jpg")
        val opts = ImageCapture.OutputFileOptions.Builder(file).build()

        capture.takePicture(opts, executor, object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                runOcr(file)
            }
            override fun onError(e: ImageCaptureException) {
                file.delete()
                isBusy = false
                onResult(false, null, "capture_failed")
            }
        })
    }

    private fun runOcr(file: File) {
        try {
            val bitmap = BitmapFactory.decodeFile(file.absolutePath)
                ?: throw IllegalArgumentException("invalid_image")
            file.delete()
            val text = OcrProcessor.recognizeBitmap(bitmap)
            isBusy = false
            if (text.isBlank()) onResult(false, null, "empty_text")
            else onResult(true, text, null)
        } catch (e: Exception) {
            file.delete()
            isBusy = false
            onResult(false, null, e.message ?: "ocr_failed")
        }
    }

    fun shutdown() {
        executor.shutdown()
    }
}
