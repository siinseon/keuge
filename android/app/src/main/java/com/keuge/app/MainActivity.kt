package com.keuge.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
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
import java.io.ByteArrayOutputStream

/**
 * WebView 셸. UI/기능(JS)는 수정하지 않고, 앱 패키징·로딩·뒤로가기만 안정화한다.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "KeugeMain"
        private const val STATE_PENDING_REQUEST_ID = "pendingImagePickRequestId"
        private const val ASSETS_INDEX = "file:///android_asset/www/index.html"
        private const val BACK_JS_FALLBACK_MS = 300L
        private const val PREVIEW_MAX_SIDE = 1920
        private const val PREVIEW_JPEG_QUALITY = 88
    }

    private lateinit var webView: WebView
    private lateinit var webBridge: WebAppBridge

    private var pendingImagePickRequestId: String? = null
    private var backJsAcknowledged = false

    private val imagePickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        val requestId = pendingImagePickRequestId
        pendingImagePickRequestId = null
        Log.d(TAG, "imagePickerLauncher: uri=${uri != null} requestId=$requestId")

        if (requestId.isNullOrBlank()) {
            Log.w(TAG, "imagePickerLauncher: pending requestId was lost; cannot deliver result")
            return@registerForActivityResult
        }

        if (uri == null) {
            webBridge.deliverOcrResult(
                requestId,
                success = false,
                text = null,
                error = "cancelled"
            )
            return@registerForActivityResult
        }

        runOcrOnUri(requestId, uri)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_PENDING_REQUEST_ID, pendingImagePickRequestId)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        pendingImagePickRequestId =
            savedInstanceState?.getString(STATE_PENDING_REQUEST_ID)
                ?: pendingImagePickRequestId
        Log.d(TAG, "onCreate: restored pendingImagePickRequestId=$pendingImagePickRequestId")

        webView = findViewById(R.id.webView)
        webBridge = WebAppBridge(this, webView) { requestId ->
            Log.d(TAG, "launching image picker: requestId=$requestId")
            pendingImagePickRequestId = requestId
            imagePickerLauncher.launch("image/*")
        }

        configureWebView()
        webView.loadUrl(ASSETS_INDEX)

        // 구형 WebView: evaluateJavascript 콜백이 null이면 onBackPressed()를 다시 호출해
        // 앱이 즉시 종료되던 문제 → JS goBack()만 호출하고 시스템 back 재전달은 하지 않음.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                dispatchBackToWeb()
            }
        })
    }

    override fun onDestroy() {
        webBridge.destroy()
        super.onDestroy()
    }

    private fun dispatchBackToWeb() {
        backJsAcknowledged = false
        val js =
            "(function(){try{if(typeof goBack==='function'){goBack();return '1';}}catch(e){}" +
            "return '0';})();"

        try {
            webView.evaluateJavascript(js) { result ->
                backJsAcknowledged = true
                Log.d(TAG, "dispatchBackToWeb evaluateJavascript result=$result")
            }
        } catch (e: Exception) {
            Log.e(TAG, "dispatchBackToWeb evaluateJavascript failed", e)
            fallbackBackViaLoadUrl()
        }

        webView.postDelayed({
            if (!backJsAcknowledged) {
                Log.w(TAG, "dispatchBackToWeb: callback timeout, loadUrl fallback")
                fallbackBackViaLoadUrl()
            }
        }, BACK_JS_FALLBACK_MS)
    }

    private fun fallbackBackViaLoadUrl() {
        try {
            webView.loadUrl("javascript:try{if(typeof goBack==='function')goBack();}catch(e){}")
        } catch (e: Exception) {
            Log.e(TAG, "fallbackBackViaLoadUrl failed", e)
        }
    }

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            // file:///android_asset/ 에서 css/js 상대 경로 로드 (UI 변경 없음, 로딩만 수정)
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }

            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                Log.e(TAG, "WebView error $errorCode $description url=$failingUrl")
                super.onReceivedError(view, errorCode, description, failingUrl)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                if (consoleMessage != null) {
                    val tag = "KeugeWeb"
                    val msg =
                        "${consoleMessage.message()} [${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}]"
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

    private fun bitmapToPreviewDataUrl(bitmap: Bitmap): String? {
        val scaled = scaleBitmapForPreview(bitmap) ?: return null
        val out = ByteArrayOutputStream()
        if (!scaled.compress(Bitmap.CompressFormat.JPEG, PREVIEW_JPEG_QUALITY, out)) return null
        val encoded = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        return "data:image/jpeg;base64,$encoded"
    }

    private fun scaleBitmapForPreview(source: Bitmap): Bitmap? {
        val maxSide = maxOf(source.width, source.height)
        if (maxSide <= PREVIEW_MAX_SIDE) return source
        val ratio = PREVIEW_MAX_SIDE.toFloat() / maxSide.toFloat()
        val w = (source.width * ratio).toInt().coerceAtLeast(1)
        val h = (source.height * ratio).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(source, w, h, true)
    }

    private fun loadPreviewDataUrlFromUri(uri: Uri): String? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, bounds)
        } ?: return null
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sample = 1
        while (bounds.outWidth / sample > PREVIEW_MAX_SIDE ||
            bounds.outHeight / sample > PREVIEW_MAX_SIDE
        ) {
            sample *= 2
        }

        val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, decodeOpts)
        } ?: return null
        return bitmapToPreviewDataUrl(bitmap)
    }

    fun runOcrOnBase64(requestId: String, base64: String) {
        Thread {
            try {
                val bytes = Base64.decode(base64, Base64.DEFAULT)
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                    ?: throw IllegalArgumentException("invalid_image")
                bitmapToPreviewDataUrl(bitmap)?.let { preview ->
                    runOnUiThread { webBridge.deliverImagePreview(preview) }
                }
                val text = OcrProcessor.recognizeBitmap(bitmap)
                runOnUiThread {
                    if (text.isBlank()) {
                        webBridge.deliverOcrResult(requestId, false, null, "empty_text")
                    } else {
                        webBridge.deliverOcrResult(requestId, true, text, null)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "runOcrOnBase64 failed", e)
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

    fun runOcrOnUri(requestId: String, uri: Uri) {
        Log.d(TAG, "runOcrOnUri: requestId=$requestId uri=$uri")
        Thread {
            try {
                loadPreviewDataUrlFromUri(uri)?.let { preview ->
                    runOnUiThread { webBridge.deliverImagePreview(preview) }
                }
                val text = NativeOcrManager.recognizeImageUri(this, uri)
                runOnUiThread {
                    if (text.isBlank()) {
                        webBridge.deliverOcrResult(requestId, false, null, "empty_text")
                    } else {
                        webBridge.deliverOcrResult(requestId, true, text, null)
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "runOcrOnUri failed", e)
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
}
