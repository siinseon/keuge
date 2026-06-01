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
import android.util.Base64
import android.util.Log
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.keuge.app.databinding.ActivityNativeCameraBinding
import java.io.ByteArrayOutputStream
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
        Log.d(TAG, "cameraIntentLauncher result: resultCode=${result.resultCode}")
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

        // 시스템 카메라 도중 액티비티가 재생성되었을 때 임시 파일 경로/launch 상태를 복원한다.
        if (savedInstanceState != null) {
            cameraLaunched = savedInstanceState.getBoolean(STATE_CAMERA_LAUNCHED, false)
            savedInstanceState.getString(STATE_PHOTO_PATH)?.let { path ->
                photoFile = File(path)
            }
        }

        Log.d(
            TAG,
            "onCreate: requestId=$requestId runOcr=$runOcr " +
                "cameraLaunched=$cameraLaunched photoFile=${photoFile?.absolutePath}"
        )
        setStatus(getString(R.string.camera_status_launching), busy = false)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(STATE_CAMERA_LAUNCHED, cameraLaunched)
        photoFile?.absolutePath?.let { outState.putString(STATE_PHOTO_PATH, it) }
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
        Log.d(
            TAG,
            "handleCaptureSuccess: file=${file?.absolutePath} " +
                "exists=${file?.exists()} length=${file?.length()}"
        )
        if (file == null || !file.exists() || file.length() == 0L) {
            finishWithError("empty_image")
            return
        }

        if (!runOcr) {
            // 사진을 보존하고, 미리보기용 작은 썸네일 base64 만 만들어 JS 로 돌려준다.
            // OCR 은 JS 가 "글자 읽기" 를 눌렀을 때 recognizeStoredImage(path) 로
            // 동일 파일에 대해 실행된다.
            setStatus(getString(R.string.camera_status_preview), busy = true)
            ocrExecutor.execute {
                // 새 촬영이 성공했으니 이전 캡처 파일들을 정리한다.
                cleanOldCaptures(keep = file)
                val previewDataUrl = try {
                    buildThumbnailDataUrl(file)
                } catch (e: Exception) {
                    Log.w(TAG, "thumbnail failed", e)
                    null
                }
                Log.d(
                    TAG,
                    "capture-only success: path=${file.absolutePath} " +
                        "previewBytes=${previewDataUrl?.length ?: 0}"
                )
                runOnUiThread {
                    finishWithCapture(file.absolutePath, previewDataUrl)
                }
            }
            return
        }

        setStatus(getString(R.string.camera_status_ocr), busy = true)

        ocrExecutor.execute {
            try {
                Log.d(TAG, "OCR: decoding bitmap")
                val bitmap = loadOrientedBitmap(file)
                    ?: throw IllegalArgumentException("invalid_image")
                Log.d(TAG, "OCR: bitmap ${bitmap.width}x${bitmap.height}, running ML Kit")
                val text = OcrProcessor.recognizeBitmap(bitmap)
                Log.d(TAG, "OCR: completed, text length=${text.length}")
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

    /** 보존된 사진 파일을 base64 data URL 로 인코딩(작게 다운샘플 + JPEG 압축). */
    private fun buildThumbnailDataUrl(file: File): String {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        val sample = computeInSampleSize(bounds.outWidth, bounds.outHeight, THUMBNAIL_MAX_DIM)

        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val raw = BitmapFactory.decodeFile(file.absolutePath, opts)
            ?: throw IllegalArgumentException("invalid_image")

        val rotation = readExifRotation(file)
        val oriented = if (rotation == 0f) raw else {
            val matrix = Matrix().apply { postRotate(rotation) }
            try {
                Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true)
            } catch (e: OutOfMemoryError) {
                raw
            }
        }

        val baos = ByteArrayOutputStream()
        oriented.compress(Bitmap.CompressFormat.JPEG, 70, baos)
        val base64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
        return "data:image/jpeg;base64,$base64"
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
        // 주의: 여기서 이전 파일을 삭제하면 안 된다.
        //   - 사용자가 재촬영을 위해 카메라를 열었다가 취소하는 경우,
        //     JS 가 추적 중인 직전 캡처본까지 사라져 "글자 읽기" 가 실패한다.
        // 이전 캡처는 새 촬영이 "성공" 했을 때만 정리한다(cleanOldCaptures).
        return File(dir, "keuge_capture_${System.currentTimeMillis()}.jpg")
    }

    /** [keep] 파일만 남기고 captures/ 디렉토리의 나머지 파일을 정리. */
    private fun cleanOldCaptures(keep: File) {
        val dir = File(cacheDir, "captures")
        dir.listFiles()?.forEach { f ->
            if (f.isFile && f.absolutePath != keep.absolutePath) {
                try { f.delete() } catch (_: Exception) {}
            }
        }
    }

    private fun setStatus(message: String, busy: Boolean) {
        binding.hintText.text = message
        binding.progressBar.visibility = if (busy) View.VISIBLE else View.GONE
    }

    private fun finishWithSuccess(text: String) {
        Log.d(TAG, "finishWithSuccess: text length=${text.length}")
        val data = Intent().apply {
            putExtra(EXTRA_SUCCESS, true)
            putExtra(EXTRA_TEXT, text)
        }
        setResult(RESULT_OK, data)
        finish()
    }

    /** 촬영(OCR 없이)만 성공한 경우. 파일 경로 + 미리보기 data URL 을 함께 반환. */
    private fun finishWithCapture(path: String, previewDataUrl: String?) {
        Log.d(TAG, "finishWithCapture: path=$path hasPreview=${previewDataUrl != null}")
        val data = Intent().apply {
            putExtra(EXTRA_SUCCESS, true)
            putExtra(EXTRA_PHOTO_PATH, path)
            if (previewDataUrl != null) {
                putExtra(EXTRA_PREVIEW_DATA_URL, previewDataUrl)
            }
        }
        setResult(RESULT_OK, data)
        finish()
    }

    private fun finishWithError(code: String) {
        Log.w(TAG, "finishWithError: code=$code")
        val data = Intent().apply {
            putExtra(EXTRA_SUCCESS, false)
            putExtra(EXTRA_ERROR, code)
        }
        setResult(RESULT_OK, data)
        finish()
    }

    private fun finishCancelled() {
        Log.d(TAG, "finishCancelled")
        setResult(RESULT_CANCELED)
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::ocrExecutor.isInitialized) ocrExecutor.shutdown()
    }

    companion object {
        private const val TAG = "KeugeNative"
        private const val MAX_DECODE_DIM = 2048
        private const val THUMBNAIL_MAX_DIM = 900
        private const val STATE_CAMERA_LAUNCHED = "cameraLaunched"
        private const val STATE_PHOTO_PATH = "photoPath"

        const val EXTRA_REQUEST_ID = "request_id"
        const val EXTRA_RUN_OCR = "run_ocr"
        const val EXTRA_SUCCESS = "success"
        const val EXTRA_TEXT = "text"
        const val EXTRA_ERROR = "error"
        const val EXTRA_PHOTO_PATH = "photo_path"
        const val EXTRA_PREVIEW_DATA_URL = "preview_data_url"

        fun createIntent(context: Context, requestId: String, runOcr: Boolean): Intent {
            return Intent(context, NativeCameraActivity::class.java).apply {
                putExtra(EXTRA_REQUEST_ID, requestId)
                putExtra(EXTRA_RUN_OCR, runOcr)
            }
        }
    }
}
