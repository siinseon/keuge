package com.keuge.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.exifinterface.media.ExifInterface
import java.io.File

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "KeugeMain"
        private const val STATE_PENDING_REQUEST_ID = "pendingCameraRequestId"
    }

    private lateinit var webView: WebView
    private lateinit var webBridge: WebAppBridge

    private val cameraLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val requestId = pendingCameraRequestId
        pendingCameraRequestId = null
        Log.d(TAG, "cameraLauncher result: resultCode=${result.resultCode} requestId=$requestId")

        if (requestId.isNullOrBlank()) {
            Log.w(TAG, "cameraLauncher: pendingCameraRequestId was lost; cannot deliver result")
            return@registerForActivityResult
        }

        if (result.resultCode != RESULT_OK) {
            webBridge.deliverOcrResult(
                requestId,
                success = false,
                text = null,
                error = "cancelled"
            )
            return@registerForActivityResult
        }

        val data = result.data
        val success = data?.getBooleanExtra(NativeCameraActivity.EXTRA_SUCCESS, false) ?: false
        val text = data?.getStringExtra(NativeCameraActivity.EXTRA_TEXT)
        val error = data?.getStringExtra(NativeCameraActivity.EXTRA_ERROR) ?: "ocr_failed"
        val photoPath = data?.getStringExtra(NativeCameraActivity.EXTRA_PHOTO_PATH)
        val previewDataUrl = data?.getStringExtra(NativeCameraActivity.EXTRA_PREVIEW_DATA_URL)
        Log.d(
            TAG,
            "cameraLauncher: success=$success textLen=${text?.length ?: 0} " +
                "path=${photoPath != null} preview=${previewDataUrl != null} error=$error"
        )

        webBridge.deliverOcrResult(
            requestId,
            success = success,
            text = text,
            error = error,
            photoPath = photoPath,
            previewDataUrl = previewDataUrl
        )
    }

    private var pendingCameraRequestId: String? = null

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_PENDING_REQUEST_ID, pendingCameraRequestId)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // 카메라 인텐트 도중 시스템이 MainActivity를 재생성하더라도
        // requestId를 잃지 않도록 복원한다. (없으면 결과를 JS로 전달 못 함)
        pendingCameraRequestId =
            savedInstanceState?.getString(STATE_PENDING_REQUEST_ID)
                ?: pendingCameraRequestId
        Log.d(TAG, "onCreate: restored pendingCameraRequestId=$pendingCameraRequestId")

        webView = findViewById(R.id.webView)
        webBridge = WebAppBridge(this, webView) { requestId, runOcr ->
            Log.d(TAG, "launching NativeCameraActivity: requestId=$requestId runOcr=$runOcr")
            pendingCameraRequestId = requestId
            cameraLauncher.launch(
                NativeCameraActivity.createIntent(this, requestId, runOcr)
            )
        }

        configureWebView()
        webView.loadUrl("file:///android_asset/www/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(function(){ if(typeof goBack==='function'){ goBack(); return true; } return false; })();"
                ) { result ->
                    if (result == "false" || result == "null") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })
    }

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: android.webkit.PermissionRequest?) {
                request?.grant(request.resources)
            }

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                if (consoleMessage != null) {
                    val tag = "KeugeWeb"
                    val msg = "${consoleMessage.message()} [${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}]"
                    when (consoleMessage.messageLevel()) {
                        ConsoleMessage.MessageLevel.ERROR -> Log.e(tag, msg)
                        ConsoleMessage.MessageLevel.WARNING -> Log.w(tag, msg)
                        else -> Log.d(tag, msg)
                    }
                }
                return true
            }
        }

        webView.addJavascriptInterface(webBridge, "Android")
    }

    fun runOcrOnBase64(requestId: String, base64: String) {
        Thread {
            try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?: throw IllegalArgumentException("invalid_image")
                val text = OcrProcessor.recognizeBitmap(bitmap)
                runOnUiThread {
                    if (text.isBlank()) {
                        webBridge.deliverOcrResult(requestId, false, null, "empty_text")
                    } else {
                        webBridge.deliverOcrResult(requestId, true, text, null)
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    webBridge.deliverOcrResult(
                        requestId,
                        false,
                        null,
                        e.message ?: "ocr_failed"
                    )
                }
            }
        }.start()
    }

    /**
     * 이미 디스크에 저장된 사진(시스템 카메라로 찍은 파일)을 OCR 한다.
     * "글자 읽기" 가 새 카메라를 열지 않고 마지막 촬영본을 인식하도록 하기 위한 진입점.
     */
    fun runOcrOnStoredPath(requestId: String, path: String) {
        Log.d(TAG, "runOcrOnStoredPath: requestId=$requestId path=$path")
        Thread {
            try {
                val file = File(path)
                if (!file.exists() || file.length() == 0L) {
                    runOnUiThread {
                        webBridge.deliverOcrResult(requestId, false, null, "empty_image")
                    }
                    return@Thread
                }
                val bitmap = loadOrientedBitmapForOcr(file)
                    ?: throw IllegalArgumentException("invalid_image")
                val text = OcrProcessor.recognizeBitmap(bitmap)
                runOnUiThread {
                    if (text.isBlank()) {
                        webBridge.deliverOcrResult(requestId, false, null, "empty_text")
                    } else {
                        webBridge.deliverOcrResult(requestId, true, text, null)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "runOcrOnStoredPath failed", e)
                runOnUiThread {
                    webBridge.deliverOcrResult(
                        requestId,
                        false,
                        null,
                        e.message ?: "ocr_failed"
                    )
                }
            }
        }.start()
    }

    private fun loadOrientedBitmapForOcr(file: File): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.absolutePath, bounds)
        val sample = computeInSampleSize(bounds.outWidth, bounds.outHeight, 2048)
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val raw = BitmapFactory.decodeFile(file.absolutePath, opts) ?: return null

        val rotation = try {
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
        while (longer / inSampleSize > reqMax) inSampleSize *= 2
        return inSampleSize
    }
}
