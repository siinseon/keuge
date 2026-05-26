package com.keuge.app

import android.graphics.BitmapFactory
import android.os.Bundle
import android.util.Base64
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var webBridge: WebAppBridge

    private val cameraLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val requestId = pendingCameraRequestId
        pendingCameraRequestId = null
        if (requestId.isNullOrBlank()) return@registerForActivityResult

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

        webBridge.deliverOcrResult(
            requestId,
            success = success,
            text = text,
            error = error
        )
    }

    private var pendingCameraRequestId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        webBridge = WebAppBridge(this, webView) { requestId, runOcr ->
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
}
