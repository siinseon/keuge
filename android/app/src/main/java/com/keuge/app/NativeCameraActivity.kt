package com.keuge.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.util.Log
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.keuge.app.databinding.ActivityNativeCameraBinding
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * 사진 촬영은 시스템 카메라 앱(ACTION_IMAGE_CAPTURE)에 위임한다.
 * 본 액티비티는 다음 책임만 갖는다:
 *   1) 임시 파일 + FileProvider URI 준비
 *   2) 카메라 인텐트 launch / 결과 수신
 *   3) (runOcr=true) ML Kit OCR 실행 후 결과 반환
 *
 * WebView/CameraX 기반 프리뷰는 더 이상 사용하지 않는다.
 */
class NativeCameraActivity : AppCompatActivity() {

    private lateinit var binding: ActivityNativeCameraBinding
    private lateinit var ocrExecutor: ExecutorService

    private var requestId: String = ""
    private var runOcr: Boolean = true
    private var photoFile: File? = null
    private var cameraLaunched: Boolean = false

    private val cameraIntentLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        when (result.resultCode) {
            Activity.RESULT_OK -> handleCaptureSuccess()
            Activity.RESULT_CANCELED -> finishCancelled()
            else -> finishWithError("capture_failed")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityNativeCameraBinding.inflate(layoutInflater)
        setContentView(binding.root)

        requestId = intent.getStringExtra(EXTRA_REQUEST_ID).orEmpty()
        runOcr = intent.getBooleanExtra(EXTRA_RUN_OCR, true)
        ocrExecutor = Executors.newSingleThreadExecutor()

        setStatus(getString(R.string.camera_status_launching), busy = false)
    }

    override fun onResume() {
        super.onResume()
        // 시스템 카메라가 첫 launch에서 한 번만 뜨도록 한다.
        if (!cameraLaunched) {
            cameraLaunched = true
            launchSystemCamera()
        }
    }

    private fun launchSystemCamera() {
        try {
            val outFile = createTempPhotoFile()
            photoFile = outFile

            val authority = "$packageName.fileprovider"
            val uri: Uri = FileProvider.getUriForFile(this, authority, outFile)

            val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            if (intent.resolveActivity(packageManager) == null) {
                finishWithError("no_camera_app")
                return
            }

            cameraIntentLauncher.launch(intent)
        } catch (e: Exception) {
            Log.e(TAG, "launchSystemCamera failed", e)
            finishWithError("camera_launch_failed")
        }
    }

    private fun handleCaptureSuccess() {
        val file = photoFile
        if (file == null || !file.exists() || file.length() == 0L) {
            finishWithError("empty_image")
            return
        }

        if (!runOcr) {
            file.delete()
            finishWithSuccess("")
            return
        }

        setStatus(getString(R.string.camera_status_ocr), busy = true)

        ocrExecutor.execute {
            try {
                val bitmap = loadOrientedBitmap(file)
                    ?: throw IllegalArgumentException("invalid_image")
                val text = OcrProcessor.recognizeBitmap(bitmap)
                file.delete()
                runOnUiThread {
                    if (text.isBlank()) finishWithError("empty_text")
                    else finishWithSuccess(text)
                }
            } catch (e: Exception) {
                Log.e(TAG, "OCR failed", e)
                file.delete()
                runOnUiThread {
                    finishWithError(e.message ?: "ocr_failed")
                }
            }
        }
    }

    private fun loadOrientedBitmap(file: File): Bitmap? {
        // 큰 사진은 메모리 부담이 크므로 적절히 다운샘플한다.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        val sample = computeInSampleSize(bounds.outWidth, bounds.outHeight, MAX_DECODE_DIM)

        val decodeOpts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val raw = BitmapFactory.decodeFile(file.absolutePath, decodeOpts) ?: return null

        val rotation = readExifRotation(file)
        if (rotation == 0f) return raw

        val matrix = Matrix().apply { postRotate(rotation) }
        return try {
            Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true)
        } catch (e: OutOfMemoryError) {
            raw
        }
    }

    private fun computeInSampleSize(width: Int, height: Int, reqMax: Int): Int {
        if (width <= 0 || height <= 0) return 1
        val longer = maxOf(width, height)
        var inSampleSize = 1
        while (longer / inSampleSize > reqMax) {
            inSampleSize *= 2
        }
        return inSampleSize
    }

    private fun readExifRotation(file: File): Float {
        return try {
            val exif = ExifInterface(file.absolutePath)
            when (exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        } catch (e: Exception) {
            0f
        }
    }

    private fun createTempPhotoFile(): File {
        val dir = File(cacheDir, "captures").apply { if (!exists()) mkdirs() }
        return File(dir, "keuge_capture_${System.currentTimeMillis()}.jpg")
    }

    private fun setStatus(message: String, busy: Boolean) {
        binding.hintText.text = message
        binding.progressBar.visibility = if (busy) View.VISIBLE else View.GONE
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

    private fun finishCancelled() {
        setResult(RESULT_CANCELED)
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::ocrExecutor.isInitialized) ocrExecutor.shutdown()
    }

    companion object {
        private const val TAG = "OCR"
        private const val MAX_DECODE_DIM = 2048

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
