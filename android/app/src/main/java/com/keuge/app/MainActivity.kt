package com.keuge.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "KeugeMain"
        private const val STATE_PENDING_REQUEST_ID = "pendingImagePickRequestId"
        private const val EXIT_CONFIRM_MS = 2000L
        private const val BACK_JS_TIMEOUT_MS = 300L
    }

    private lateinit var webView: WebView
    private lateinit var webBridge: WebAppBridge

    private var pendingImagePickRequestId: String? = null
    private var lastBackPressMs = 0L
    private var backJsHandled = false

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
        webView.loadUrl("file:///android_asset/www/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                handleHardwareBackPress()
            }
        })
    }

    override fun onDestroy() {
        webBridge.destroy()
        super.onDestroy()
    }

    /**
     * 하드웨어 뒤로가기 처리.
     *
     * - WebView.canGoBack() 은 file:// 단일 페이지 SPA 에서 사용하지 않는다.
     * - evaluateJavascript 콜백이 구형 WebView 에서 null/누락되면
     *   onBackPressed() 재호출로 앱이 즉시 종료되던 문제를 제거한다.
     * - JS [NavigationManager.handleHardwareBack] + [navBackState] 미러를 함께 사용한다.
     */
    private fun handleHardwareBackPress() {
        val mirrored = webBridge.navBackState
        Log.d(TAG, "handleHardwareBackPress: mirrored=$mirrored")

        when (mirrored) {
            "home" -> {
                promptExitWithDoubleBack()
                return
            }
            "splash" -> {
                runJsBackHandler()
                return
            }
            "modal", "inner" -> {
                runJsBackHandler()
                return
            }
        }

        runJsBackHandler()
    }

    private fun runJsBackHandler() {
        backJsHandled = false

        val js = "(function(){try{" +
            "if(typeof window.__keugeHandleBack==='function'){" +
            "return window.__keugeHandleBack();" +
            "}" +
            "if(typeof NavigationManager!=='undefined'&&NavigationManager.handleHardwareBack){" +
            "return JSON.stringify(NavigationManager.handleHardwareBack());" +
            "}" +
            "if(typeof goBack==='function'){goBack();return JSON.stringify({action:'back'});}" +
            "return JSON.stringify({action:'exit'});" +
            "}catch(e){return JSON.stringify({action:'exit'});}})();"

        try {
            webView.evaluateJavascript(js) { result ->
                backJsHandled = true
                onBackJsResult(result)
            }
        } catch (e: Exception) {
            Log.e(TAG, "evaluateJavascript(back) failed", e)
            onBackJsFallback()
        }

        // 구형 WebView: ValueCallback 이 호출되지 않는 경우 타임아웃 fallback
        webView.postDelayed({
            if (!backJsHandled) {
                Log.w(TAG, "back js timeout (${BACK_JS_TIMEOUT_MS}ms), using mirrored=$mirrored")
                onBackJsFallback()
            }
        }, BACK_JS_TIMEOUT_MS)
    }

    private fun onBackJsResult(result: String?) {
        Log.d(TAG, "onBackJsResult: raw=$result")
        val action = parseBackAction(result)
        when (action) {
            "exit" -> promptExitWithDoubleBack()
            "back", "close_modal" -> { /* consumed by JS */ }
            else -> onBackJsFallback()
        }
    }

    private fun onBackJsFallback() {
        when (webBridge.navBackState) {
            "home" -> promptExitWithDoubleBack()
            "modal", "inner", "splash" -> runJsBackViaLoadUrl()
            else -> promptExitWithDoubleBack()
        }
    }

    /** evaluateJavascript 가 실패할 때 loadUrl javascript: fallback (WebView 90 이하). */
    private fun runJsBackViaLoadUrl() {
        try {
            webView.loadUrl(
                "javascript:try{" +
                    "if(window.__keugeHandleBack){window.__keugeHandleBack();}" +
                    "else if(typeof goBack==='function'){goBack();}" +
                    "}catch(e){}"
            )
        } catch (e: Exception) {
            Log.e(TAG, "loadUrl(back) failed", e)
            if (webBridge.navBackState == "home") {
                promptExitWithDoubleBack()
            }
        }
    }

    private fun parseBackAction(result: String?): String? {
        if (result.isNullOrBlank() || result == "null") return null
        var s = result.trim()
        if (s.length >= 2 && s.startsWith("\"") && s.endsWith("\"")) {
            s = s.substring(1, s.length - 1)
                .replace("\\\"", "\"")
                .replace("\\\\", "\\")
        }
        return try {
            JSONObject(s).optString("action", "").ifBlank { null }
        } catch (e: Exception) {
            Log.w(TAG, "parseBackAction failed: $result", e)
            null
        }
    }

    private fun promptExitWithDoubleBack() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastBackPressMs < EXIT_CONFIRM_MS) {
            Log.d(TAG, "promptExitWithDoubleBack: finishing")
            finishAffinity()
            return
        }
        lastBackPressMs = now
        val msg = "한 번 더 누르면 종료합니다"
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        try {
            webView.evaluateJavascript(
                "try{" +
                    "typeof showToast==='function'&&showToast('한 번 더 누르면 종료합니다');" +
                    "if(typeof NavigationManager!=='undefined')NavigationManager.announce('한 번 더 누르면 종료합니다',true);" +
                    "}catch(e){}",
                null
            )
        } catch (e: Exception) {
            Log.w(TAG, "exit toast js failed", e)
        }
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

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                try {
                    view?.evaluateJavascript(
                        "try{if(typeof NavigationManager!=='undefined')NavigationManager.syncNavBackState();}catch(e){}",
                        null
                    )
                } catch (e: Exception) {
                    Log.w(TAG, "onPageFinished syncNavBackState failed", e)
                }
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
