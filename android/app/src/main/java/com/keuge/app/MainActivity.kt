package com.keuge.app

import android.os.Bundle
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
        if (result.resultCode != RESULT_OK) {
            webBridge.deliverResult(false, null, "cancelled")
            return@registerForActivityResult
        }
        val data = result.data
        val success = data?.getBooleanExtra(NativeCameraActivity.EXTRA_SUCCESS, false) ?: false
        val text    = data?.getStringExtra(NativeCameraActivity.EXTRA_TEXT)
        val error   = if (!success) (data?.getStringExtra(NativeCameraActivity.EXTRA_ERROR) ?: "ocr_failed") else null
        webBridge.deliverResult(success, text, error)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        webBridge = WebAppBridge(this, webView) {
            cameraLauncher.launch(NativeCameraActivity.createIntent(this))
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
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = false
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: android.webkit.PermissionRequest?) {
                request?.grant(request.resources)
            }
        }
        webView.addJavascriptInterface(webBridge, "Android")
    }

    override fun onDestroy() {
        super.onDestroy()
        webBridge.destroy()
    }
}
