package com.siinseon.keuge

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * WebView 셸. UI/기능(JS)는 수정하지 않고, 앱 패키징·로딩·뒤로가기만 안정화한다.
 */
class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "KeugeMain"
        private const val STATE_PENDING_REQUEST_ID = "pendingImagePickRequestId"
        private const val ASSETS_INDEX = "file:///android_asset/www/index.html"
        const val MENU_PREVIEW_URL = "https://app.keuge/menu-preview.jpg"
        private const val PREVIEW_MAX_SIDE = 1920
        private const val PREVIEW_JPEG_QUALITY = 88
        /** evaluateJavascript 용량 한도 회피 — 브리지 fallback 미리보기 */
        private const val PREVIEW_BRIDGE_MAX_SIDE = 720
        private const val PREVIEW_BRIDGE_JPEG_QUALITY = 72
    }

    private lateinit var webView: WebView
    private lateinit var webBridge: WebAppBridge

    private var pendingImagePickRequestId: String? = null
    private var lastPickedUri: Uri? = null
    private var lastPickedCacheFile: File? = null
    private var webFilePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingRecordAudioAction: (() -> Unit)? = null
    private var pendingWebViewPermissionRequest: PermissionRequest? = null

    private val recordAudioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        Log.d(TAG, "RECORD_AUDIO permission granted=$granted")
        if (granted) {
            pendingRecordAudioAction?.invoke()
        } else {
            if (::webBridge.isInitialized) {
                webBridge.deliverSttResult(
                    "perm-denied-${System.currentTimeMillis()}",
                    false, null, "no_permission"
                )
            }
        }
        pendingRecordAudioAction = null
        pendingWebViewPermissionRequest?.also { req ->
            if (granted) req.grant(req.resources) else req.deny()
            pendingWebViewPermissionRequest = null
        }
    }

    /** RECORD_AUDIO 권한이 있으면 바로 action 실행, 없으면 요청 후 실행 */
    fun ensureRecordAudioPermission(action: () -> Unit) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED
        ) {
            action()
        } else {
            pendingRecordAudioAction = action
            recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

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
            webBridge.deliverImagePicked(requestId, success = false, error = "cancelled")
            return@registerForActivityResult
        }

        onMenuImagePicked(requestId, uri)
    }

    /** WebView <input type="file"> fallback (브리지 감지 실패 시) */
    private val webFileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri ->
        val callback = webFilePathCallback
        webFilePathCallback = null
        if (callback == null) {
            Log.w(TAG, "webFileChooserLauncher: callback was null")
            return@registerForActivityResult
        }
        callback.onReceiveValue(if (uri == null) null else arrayOf(uri))
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
        // JS goBack()이 'handled'(이전 화면 이동) / 'root'(홈, 더 뒤로 없음) / 'error'(JS 오류) 반환
        val js =
            "(function(){" +
            "try{if(typeof goBack==='function'){var r=goBack();return r?String(r):'handled';}}" +
            "catch(e){}" +
            "return 'error';" +
            "})()"

        try {
            webView.evaluateJavascript(js) { result ->
                val r = result?.trim('"') ?: "error"
                Log.d(TAG, "dispatchBackToWeb result=$r")
                when (r) {
                    "root"  -> finish()               // 더 뒤로 갈 화면 없음 → 앱 종료
                    "error" -> fallbackBackViaLoadUrl() // JS 오류 → loadUrl 폴백
                    // "handled" → JS에서 이미 이전 화면으로 전환됨
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "dispatchBackToWeb failed", e)
            fallbackBackViaLoadUrl()
        }
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

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectNativeBridgeFlags(view)
            }

            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                val uri = request.url
                if (uri.host == "app.keuge" && uri.path == "/menu-preview.jpg") {
                    val file = getMenuPreviewCacheFile()
                    if (file != null) {
                        return try {
                            WebResourceResponse(
                                "image/jpeg",
                                null,
                                file.inputStream()
                            )
                        } catch (e: Exception) {
                            Log.e(TAG, "menu preview intercept failed", e)
                            null
                        }
                    }
                }
                return super.shouldInterceptRequest(view, request)
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
            override fun onPermissionRequest(request: PermissionRequest?) {
                if (request == null) return
                val needsMic = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                if (!needsMic) {
                    request.deny()
                    return
                }
                if (ContextCompat.checkSelfPermission(
                        this@MainActivity, Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED
                ) {
                    request.grant(request.resources)
                } else {
                    pendingWebViewPermissionRequest = request
                    recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                webFilePathCallback?.onReceiveValue(null)
                webFilePathCallback = filePathCallback
                Log.d(TAG, "onShowFileChooser: launching picker")
                try {
                    webFileChooserLauncher.launch("image/*")
                    return true
                } catch (e: Exception) {
                    Log.e(TAG, "onShowFileChooser failed", e)
                    webFilePathCallback = null
                    filePathCallback?.onReceiveValue(null)
                    return false
                }
            }

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

    /** JS typeof 검사가 실패해도 네이티브 기능을 켤 수 있도록 capability 플래그 주입 */
    private fun injectNativeBridgeFlags(view: WebView?) {
        if (view == null) return
        val js =
            "(function(){try{" +
            "window.__KEUGE_NATIVE__={bridge:1,picker:1,ocr:1,tts:1,brands:1," +
            "selectMenuImage:1,recognizeMenuImage:1,recognizeTextFromBase64:1,loadBrandsJson:1," +
            "speakText:1,stopSpeak:1,getMenuPreviewUrl:1," +
            "startVoiceSearch:1,stopVoiceSearch:1,isSttAvailable:1};" +
            "if(window.console)console.log('[Keuge] native bridge flags injected',!!window.Android);" +
            "}catch(e){if(window.console)console.error('[Keuge] bridge inject failed',e);}})();"
        try {
            view.evaluateJavascript(js, null)
        } catch (e: Exception) {
            Log.e(TAG, "injectNativeBridgeFlags evaluateJavascript failed", e)
            try {
                view.loadUrl("javascript:$js")
            } catch (e2: Exception) {
                Log.e(TAG, "injectNativeBridgeFlags loadUrl failed", e2)
            }
        }
    }

    private fun bitmapToPreviewDataUrl(
        bitmap: Bitmap,
        maxSide: Int = PREVIEW_MAX_SIDE,
        jpegQuality: Int = PREVIEW_JPEG_QUALITY
    ): String? {
        val scaled = scaleBitmapForPreview(bitmap, maxSide) ?: return null
        val out = ByteArrayOutputStream()
        if (!scaled.compress(Bitmap.CompressFormat.JPEG, jpegQuality, out)) return null
        val encoded = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        return "data:image/jpeg;base64,$encoded"
    }

    private fun scaleBitmapForPreview(source: Bitmap, maxSide: Int): Bitmap? {
        val longest = maxOf(source.width, source.height)
        if (longest <= maxSide) return source
        val ratio = maxSide.toFloat() / longest.toFloat()
        val w = (source.width * ratio).toInt().coerceAtLeast(1)
        val h = (source.height * ratio).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(source, w, h, true)
    }

    private fun loadPreviewDataUrlFromUri(
        uri: Uri,
        maxSide: Int = PREVIEW_MAX_SIDE,
        jpegQuality: Int = PREVIEW_JPEG_QUALITY
    ): String? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, bounds)
        } ?: return null
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sample = 1
        while (bounds.outWidth / sample > maxSide ||
            bounds.outHeight / sample > maxSide
        ) {
            sample *= 2
        }

        val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, decodeOpts)
        } ?: return null
        return bitmapToPreviewDataUrl(bitmap, maxSide, jpegQuality)
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

    fun getLastPickedUri(): Uri? = lastPickedUri

    fun hasCachedPickImage(): Boolean {
        val f = lastPickedCacheFile
        return f != null && f.isFile && f.length() > 0L
    }

    fun getMenuPreviewCacheFile(): File? {
        val f = lastPickedCacheFile
        return if (f != null && f.isFile && f.length() > 0L) f else null
    }

    /** 갤러리 URI를 앱 캐시로 복사 — [읽어주기] 시 권한 만료 없이 OCR */
    private fun cachePickedImage(sourceUri: Uri): File? {
        val out = File(cacheDir, "keuge_menu_pick.jpg")
        return try {
            contentResolver.openInputStream(sourceUri)?.use { input ->
                out.outputStream().use { output -> input.copyTo(output) }
            } ?: return null
            if (!out.isFile || out.length() <= 0L) return null
            lastPickedCacheFile = out
            Log.d(TAG, "cachePickedImage: ${out.length()} bytes")
            out
        } catch (e: Exception) {
            Log.e(TAG, "cachePickedImage failed", e)
            null
        }
    }

    /** 사진 선택 직후: 미리보기만 전달, OCR은 [읽어주기] 시 실행 */
    private fun onMenuImagePicked(requestId: String, uri: Uri) {
        lastPickedUri = uri
        Log.d(TAG, "onMenuImagePicked: requestId=$requestId uri=$uri")
        Thread {
            try {
                val cached = cachePickedImage(uri)
                val compactPreview = if (cached == null) {
                    loadPreviewDataUrlFromUri(
                        uri,
                        PREVIEW_BRIDGE_MAX_SIDE,
                        PREVIEW_BRIDGE_JPEG_QUALITY
                    )
                } else {
                    null
                }
                runOnUiThread {
                    when {
                        cached != null -> webBridge.deliverNativeImageReady()
                        compactPreview != null -> webBridge.deliverImagePreview(compactPreview)
                        else -> {
                            webBridge.deliverImagePicked(requestId, success = false, error = "invalid_image")
                            return@runOnUiThread
                        }
                    }
                    webBridge.deliverImagePicked(requestId, success = true, error = null)
                }
            } catch (e: Exception) {
                Log.e(TAG, "onMenuImagePicked failed", e)
                runOnUiThread {
                    webBridge.deliverImagePicked(requestId, success = false, error = e.message ?: "invalid_image")
                }
            }
        }.start()
    }

    /** [읽어주기]: 캐시된 사진 파일로 OCR (URI 권한·JS 대용량 base64 회피) */
    fun runOcrOnCachedPick(requestId: String) {
        val file = lastPickedCacheFile
        if (file == null || !file.isFile || file.length() <= 0L) {
            Log.w(TAG, "runOcrOnCachedPick: no cache file")
            runOnUiThread {
                webBridge.deliverOcrResult(requestId, false, null, "empty_image")
            }
            return
        }
        Log.d(TAG, "runOcrOnCachedPick: requestId=$requestId file=${file.absolutePath}")
        Thread {
            try {
                val bitmap = BitmapFactory.decodeFile(file.absolutePath)
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
                Log.e(TAG, "runOcrOnCachedPick failed", e)
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
