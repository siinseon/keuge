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

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "KeugeMain"
        private const val STATE_PENDING_REQUEST_ID = "pendingImagePickRequestId"
    }

    private lateinit var webView: WebView
    private lateinit var webBridge: WebAppBridge

    private val imagePickerLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        val requestId = pendingImagePickRequestId
        pendingImagePickRequestId = null
        Log.d(TAG, "imagePickerLauncher result: uri=${uri != null} requestId=$requestId")

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

    private var pendingImagePickRequestId: String? = null

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_PENDING_REQUEST_ID, pendingImagePickRequestId)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        // 사진 선택 도중 시스템이 MainActivity를 재생성하더라도
        // requestId를 잃지 않도록 복원한다. (없으면 결과를 JS로 전달 못 함)
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

    override fun onDestroy() {
        webBridge.destroy()
        super.onDestroy()
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

    fun runOcrOnUri(requestId: String, uri: Uri) {
        Log.d(TAG, "runOcrOnUri: requestId=$requestId uri=$uri")
        Thread {
            try {
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
