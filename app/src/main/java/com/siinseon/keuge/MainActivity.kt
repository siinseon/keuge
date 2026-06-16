package com.siinseon.keuge

import android.annotation.SuppressLint
import android.Manifest
import android.util.Log
import android.content.pm.PackageManager
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.SslErrorHandler
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var ttsManager: NativeTtsManager
    private lateinit var ocrManager: NativeOcrManager

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        requestAppPermissions()
        ttsManager = NativeTtsManager(this)
        ocrManager = NativeOcrManager()

        webView = WebView(this)
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        webView.scrollBarStyle = View.SCROLLBARS_OUTSIDE_OVERLAY

        webView.webViewClient = KeugeWebViewClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                val res = request?.resources?.joinToString(prefix = "[", postfix = "]") ?: "null"
                Log.d("OCR", "onPermissionRequest before grant resources=$res")
                request?.grant(request.resources)
                Log.d("OCR", "onPermissionRequest after grant")
            }
        }

        configureWebView(webView.settings)
        webView.addJavascriptInterface(
            WebAppInterface(
                speakHandler = { text -> speakNative(text) },
                stopHandler = { stopNativeTts() },
                readyChecker = { ttsManager.isReady },
                ocrHandler = { requestId, imageBase64 -> runOcr(requestId, imageBase64) }
            ),
            "Android"
        )

        Log.d("OCR", "loading url=$WEB_APP_URL")
        webView.loadUrl(WEB_APP_URL)
        setContentView(webView)
    }

    private inner class KeugeWebViewClient : WebViewClient() {

        override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
            Log.d("OCR", "onPageStarted url=$url")
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            Log.d("OCR", "onPageFinished url=$url")
        }

        @Suppress("DEPRECATION")
        override fun onReceivedError(
            view: WebView?,
            errorCode: Int,
            description: String?,
            failingUrl: String?,
        ) {
            Log.e("OCR", "onReceivedError legacy code=$errorCode desc=$description url=$failingUrl")
            super.onReceivedError(view, errorCode, description, failingUrl)
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError,
        ) {
            Log.e(
                "OCR",
                "onReceivedError main=${request.isForMainFrame} code=${error.errorCode}" +
                    " desc=${error.description} url=${request.url}",
            )
            super.onReceivedError(view, request, error)
        }

        override fun onReceivedHttpError(
            view: WebView?,
            request: WebResourceRequest?,
            errorResponse: WebResourceResponse?,
        ) {
            Log.e(
                "OCR",
                "onReceivedHttpError status=${errorResponse?.statusCode}" +
                    " reason=${errorResponse?.reasonPhrase} url=${request?.url}",
            )
            super.onReceivedHttpError(view, request, errorResponse)
        }

        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
            Log.e(
                "OCR",
                "onReceivedSslError primaryError=${error?.primaryError} url=${error?.url}",
            )
            handler?.cancel()
        }
    }

    private fun requestAppPermissions() {
        val needed = arrayOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.CAMERA
        ).filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), PERMISSION_REQUEST_CODE)
        }
    }

    private fun configureWebView(settings: WebSettings) {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.loadsImagesAutomatically = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.textZoom = 100

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            settings.offscreenPreRaster = true
        }

        Log.d(
            "OCR",
            "WebSettings javaScriptEnabled=${settings.javaScriptEnabled} " +
                "domStorageEnabled=${settings.domStorageEnabled} " +
                "mediaPlaybackRequiresUserGesture=${settings.mediaPlaybackRequiresUserGesture}",
        )
    }

    private fun runOcr(requestId: String, imageBase64: String) {
        Log.d("OCR", "MainActivity.runOcr requestId=$requestId base64Len=${imageBase64.length}")
        ocrManager.recognizeFromBase64(
            imageBase64 = imageBase64,
            onSuccess = { text -> dispatchOcrResult(requestId, true, text, "") },
            onFailure = { error -> dispatchOcrResult(requestId, false, "", error) }
        )
    }

    private fun dispatchOcrResult(
        requestId: String,
        success: Boolean,
        text: String,
        error: String
    ) {
        val payload = JSONObject()
            .put("requestId", requestId)
            .put("success", success)
            .put("text", text)
            .put("error", error)
            .toString()

        runOnUiThread {
            Log.d("OCR", "dispatchOcrResult evaluateJavascript requestId=$requestId success=$success")
            webView.evaluateJavascript(
                "window.KeugeOcr&&window.KeugeOcr._complete($payload);",
                null
            )
        }
    }

    private fun speakNative(text: String) {
        runOnUiThread { ttsManager.speak(text) }
    }

    private fun stopNativeTts() {
        runOnUiThread { ttsManager.stop() }
    }

    override fun onDestroy() {
        ocrManager.shutdown()
        ttsManager.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val WEB_APP_URL = "https://keuge.vercel.app/"
        private const val PERMISSION_REQUEST_CODE = 1
    }
}