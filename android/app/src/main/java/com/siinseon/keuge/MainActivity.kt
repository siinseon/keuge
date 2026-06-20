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
        const val MENU_PREVIEW_URL = "https://app.keuge/menu-previewic_launcher.png"
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

        // Android 13~16 대응: OnBackPressedDispatcher (AndroidX activity-ktx) 는
        // API 33+ 에서 자동으로 OnBackInvokedCallback 을 사용하며,
        // AndroidManifest 의 android:enableOnBackInvokedCallback="true" 와 함께
        // 예측형 뒤로가기(predictive back) 도 지원한다.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                handleBackPressed()
            }
        })
    }

    override fun onDestroy() {
        webBridge.destroy()
        super.onDestroy()
    }

    /**
     * 뒤로가기 처리 정책:
     * 1) WebView 의 URL 히스토리(canGoBack) 가 있으면 이전 페이지로 이동
     * 2) 없으면 SPA 의 화면 히스토리(JS goBack) 를 호출
     *    - 이미 루트(홈) 면 'root' 반환 → 앱 종료
     *    - 이전 화면이 남아 있으면 JS 가 화면 전환, Kotlin 은 대기
     * 3) JS 평가 자체가 실패하면 안전망으로 finish() 호출
     */
    private fun handleBackPressed() {
        if (webView.canGoBack()) {
            Log.d(TAG, "handleBackPressed: webView.canGoBack()=true → goBack()")
            webView.goBack()
            return
        }
        dispatchBackToWebOrFinish()
    }

    private fun dispatchBackToWebOrFinish() {
        // 현재 SPA 의 js/main.js#goBack() 은 반환값이 없어 루트 여부를 알 수 없으므로,
        // AppState.screenHistory.length 를 Kotlin 에서 직접 조회한다.
        // (web 자산은 수정하지 않는다는 요구사항 준수)
        val js = """
            (function(){
              try {
                var fs = document.getElementById('previewFullscreen');
                var fsOpen = fs && fs.classList && fs.classList.contains('is-open');
                if (fsOpen) {
                  if (typeof MenuPreviewZoom !== 'undefined' && MenuPreviewZoom && typeof MenuPreviewZoom.close === 'function') {
                    MenuPreviewZoom.close();
                  }
                  return 'handled';
                }
                var hist = (typeof AppState !== 'undefined' && AppState && Array.isArray(AppState.screenHistory))
                  ? AppState.screenHistory.length : 0;
                if (hist <= 1) {
                  return 'root';
                }
                if (typeof goBack === 'function') {
                  goBack();
                  return 'handled';
                }
              } catch (e) {}
              return 'error';
            })()
        """.trimIndent()

        try {
            webView.evaluateJavascript(js) { result ->
                val r = result?.trim('"') ?: "error"
                Log.d(TAG, "dispatchBackToWebOrFinish result=$r")
                when (r) {
                    "handled" -> { /* JS 가 이전 화면으로 전환 완료 */ }
                    "root"    -> finish()
                    else      -> finish() // 'error' 또는 예상 못한 반환값 → 앱 종료
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "dispatchBackToWebOrFinish failed", e)
            finish()
        }
    }

    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true

            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = true

            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = true

            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_NO_CACHE

            // 모바일 layout viewport 안정화: 일부 단말 WebView 가 wide viewport 모드에서
            // 내부 overflow:scroll 컨테이너의 hit-test 가 어긋나 하단 영역 터치가 막히는 문제 방지.
            useWideViewPort = true
            loadWithOverviewMode = true
        }

// apply 블록 밖으로 빼기
        webView.clearCache(true)
        webView.clearHistory()

        // Nested scrolling: API 21+ 기본 활성화이지만, 일부 OEM ROM 에서 비활성화되는
        // 사례가 보고됨. CSS 의 inner overflow scroll 과 시스템 스크롤이 자연스럽게
        // 협업하도록 명시적으로 켠다.
        webView.isNestedScrollingEnabled = true
        // 컨텐츠가 화면을 가득 채우는 경우 reactive over-scroll glow 가 내부 스크롤
        // 시작 터치를 가로채는 것을 방지.
        webView.overScrollMode = android.view.View.OVER_SCROLL_IF_CONTENT_SCROLLS
        // WebView 가 부모 ViewGroup(ConstraintLayout) 으로 터치를 양보하지 않도록 명시.
        // 일부 OEM 의 ConstraintLayout 구현이 자식의 down/move 이벤트를 가로채는 사례가
        // 보고된 적이 있어, 하단 영역 터치/스크롤이 산발적으로 막히는 문제를 예방한다.
        // (이벤트는 WebView 의 기본 처리에 그대로 위임하므로 performClick 호출은 불필요)
        @Suppress("ClickableViewAccessibility")
        webView.setOnTouchListener { v, event ->
            if (event.actionMasked == android.view.MotionEvent.ACTION_DOWN) {
                v.parent?.requestDisallowInterceptTouchEvent(true)
            }
            false
        }
        // 키보드 입력과 클릭 포커스 동작 안정화 (검색 화면 input 등).
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true

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
                if (uri.host == "app.keuge" && uri.path == "/menu-previewic_launcher.png") {
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
        val out = File(cacheDir, "keuge_menu_pickic_launcher.png")
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
