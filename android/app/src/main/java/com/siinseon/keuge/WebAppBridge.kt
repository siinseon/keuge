package com.siinseon.keuge

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.annotation.Keep

@Keep
class WebAppBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val onImagePickRequested: (requestId: String) -> Unit
) {

    private val ttsManager = NativeTtsManager(activity)
    private val sttManager = NativeSttManager(activity)

    @Keep
    @JavascriptInterface
    fun speakText(text: String?) {
        ttsManager.speak(text)
    }

    @Keep
    @JavascriptInterface
    fun stopSpeak() {
        ttsManager.stop()
    }

    @Keep
    @JavascriptInterface
    fun isTtsReady(): Boolean = ttsManager.isReady()

    /** JS 브리지 연결 확인용 (typeof 검사 대신 호출 가능) */
    @Keep
    @JavascriptInterface
    fun isBridgeReady(): Boolean {
        Log.d(TAG, "isBridgeReady called - bridge is working")
        return true
    }

    /** 네이티브 STT 가용 여부 확인 */
    @Keep
    @JavascriptInterface
    fun isSttAvailable(): Boolean = sttManager.isAvailable()

    /** 음성 검색 시작 — JS 콜백: window.KeugeSTT._onResult({requestId, success, transcript, error}) */
    @Keep
    @JavascriptInterface
    fun startVoiceSearch(requestId: String?) {
        val rid = if (requestId.isNullOrBlank()) "stt-${System.currentTimeMillis()}" else requestId
        Log.d(TAG, "startVoiceSearch: requestId=$rid")
        activity.runOnUiThread {
            if (!sttManager.isAvailable()) {
                Log.w(TAG, "startVoiceSearch: STT not available on this device")
                deliverSttResult(rid, false, null, "not_available:0")
                return@runOnUiThread
            }
            activity.ensureRecordAudioPermission {
                sttManager.start(
                    rid,
                    onResult = { id, transcript -> deliverSttResult(id, true, transcript, null) },
                    onError = { id, error -> deliverSttResult(id, false, null, error) }
                )
            }
        }
    }

    /** 음성 검색 중단 */
    @Keep
    @JavascriptInterface
    fun stopVoiceSearch() {
        Log.d(TAG, "stopVoiceSearch")
        sttManager.stop()
    }

    fun deliverSttResult(requestId: String, success: Boolean, transcript: String?, error: String?) {
        val rid = jsStringLiteral(requestId)
        val successJs = if (success) "true" else "false"
        val textJs = if (!transcript.isNullOrBlank()) jsStringLiteral(transcript) else "null"
        val errJs = if (!error.isNullOrBlank()) jsStringLiteral(error) else "null"
        val js = "(function(){try{" +
            "var p={requestId:$rid,success:$successJs,transcript:$textJs,error:$errJs};" +
            "if(window.console)console.log('[KeugeStt] result',p.success,p.transcript||p.error);" +
            "if(window.KeugeSTT&&window.KeugeSTT._onResult){window.KeugeSTT._onResult(p);}" +
            "}catch(e){if(window.console)console.error('[KeugeStt] deliver',e);}})();"
        Log.d(TAG, "deliverSttResult: requestId=$requestId success=$success transcript=$transcript error=$error")
        runJsOnWebView(js)
    }

    fun deliverSttListeningState(isListening: Boolean) {
        val js = "(function(){try{" +
            "if(window.KeugeSTT&&window.KeugeSTT._onListeningState){window.KeugeSTT._onListeningState($isListening);}" +
            "}catch(e){if(window.console)console.error('[KeugeStt] listenState',e);}})();"
        runJsOnWebView(js)
    }

    /** WebView file:// 에서 fetch 불가 — assets 의 brands.json 전체를 동기 반환 */
    @Keep
    @JavascriptInterface
    fun loadBrandsJson(): String {
        return try {
            activity.assets.open("www/data/brands.json").bufferedReader(Charsets.UTF_8).use { it.readText() }
        } catch (e: Exception) {
            Log.e(TAG, "loadBrandsJson failed", e)
            ""
        }
    }

    /** [읽어주기] 탭 시 저장된 사진 URI로 ML Kit OCR */
    @Keep
    @JavascriptInterface
    fun recognizeMenuImage(ocrRequestId: String?) {
        if (ocrRequestId.isNullOrBlank()) {
            Log.w(TAG, "recognizeMenuImage: blank ocrRequestId")
            return
        }
        Log.d(TAG, "recognizeMenuImage: ocrRequestId=$ocrRequestId cached=${activity.hasCachedPickImage()}")
        activity.runOnUiThread {
            if (activity.hasCachedPickImage()) {
                activity.runOcrOnCachedPick(ocrRequestId)
            } else {
                val uri = activity.getLastPickedUri()
                if (uri == null) {
                    deliverOcrResult(ocrRequestId, false, null, "empty_image")
                } else {
                    activity.runOcrOnUri(ocrRequestId, uri)
                }
            }
        }
    }

    /** 캐시된 메뉴 사진 file:// URL — base64 브리지 대신 img src 로 사용 */
    @Keep
    @JavascriptInterface
    fun getMenuPreviewUrl(): String {
        return if (activity.getMenuPreviewCacheFile() != null) {
            MainActivity.MENU_PREVIEW_URL
        } else {
            ""
        }
    }

    /** 갤러리/최근 사진 선택 (미리보기만, OCR은 recognizeMenuImage) */
    @Keep
    @JavascriptInterface
    fun selectMenuImage(requestId: String?) {
        Log.d(TAG, "selectMenuImage CALLED: requestId=$requestId")
        if (requestId.isNullOrBlank()) {
            Log.w(TAG, "selectMenuImage: blank requestId")
            return
        }
        Log.d(TAG, "selectMenuImage: launching picker for requestId=$requestId")
        activity.runOnUiThread {
            try {
                onImagePickRequested(requestId)
                Log.d(TAG, "selectMenuImage: onImagePickRequested invoked successfully")
            } catch (e: Exception) {
                Log.e(TAG, "selectMenuImage: onImagePickRequested failed", e)
            }
        }
    }

    /** 레거시: base64 JPEG → ML Kit (PC 디버그·호환) */
    @Keep
    @JavascriptInterface
    fun recognizeTextFromBase64(requestId: String?, base64: String?) {
        if (requestId.isNullOrBlank()) {
            Log.w(TAG, "recognizeTextFromBase64: blank requestId")
            return
        }
        if (base64.isNullOrBlank()) {
            Log.w(TAG, "recognizeTextFromBase64: empty base64 (bridge size limit?)")
            deliverOcrResult(requestId, false, null, "empty_image")
            return
        }
        Log.d(TAG, "recognizeTextFromBase64: requestId=$requestId len=${base64.length}")
        activity.runOnUiThread {
            activity.runOcrOnBase64(requestId, base64)
        }
    }

    fun deliverImagePicked(requestId: String, success: Boolean, error: String?) {
        val rid = jsStringLiteral(requestId)
        val successJs = if (success) "true" else "false"
        val errJs = if (!error.isNullOrBlank()) jsStringLiteral(error) else "null"
        val js = "(function(){try{" +
            "var p={requestId:$rid,success:$successJs,error:$errJs};" +
            "if(window.KeugeOcr&&window.KeugeOcr._imagePicked){window.KeugeOcr._imagePicked(p);}" +
            "}catch(e){if(window.console)console.error('[KeugeOcr] picked',e);}})();"

        Log.d(TAG, "deliverImagePicked: requestId=$requestId success=$success error=$error")
        runJsOnWebView(js)
    }

    fun deliverImagePreview(dataUrl: String) {
        if (dataUrl.isBlank()) return
        val jsLiteral = jsStringLiteral(dataUrl)
        val js = "(function(){try{" +
            "var u=$jsLiteral;" +
            "if(window.__keugeShowMenuPreview){window.__keugeShowMenuPreview(u);}" +
            "}catch(e){if(window.console)console.error('[KeugeOcr] preview',e);}})();"

        Log.d(TAG, "deliverImagePreview: len=${dataUrl.length}")
        runJsOnWebView(js)
    }

    /** 캐시 파일 경로로 미리보기 — 대용량 base64 evaluateJavascript 한도 회피 */
    fun deliverNativeImageReady() {
        val js = "(function(){try{" +
            "if(window.__keugeOnNativeImageReady){window.__keugeOnNativeImageReady();}" +
            "}catch(e){if(window.console)console.error('[KeugeOcr] native ready',e);}})();"
        Log.d(TAG, "deliverNativeImageReady")
        runJsOnWebView(js)
    }

    fun deliverOcrResult(
        requestId: String,
        success: Boolean,
        text: String?,
        error: String?
    ) {
        val rid = jsStringLiteral(requestId)
        val successJs = if (success) "true" else "false"
        val textJs = if (!text.isNullOrBlank()) jsStringLiteral(text) else "null"
        val errJs = if (!error.isNullOrBlank()) jsStringLiteral(error) else "null"

        val js = "(function(){try{" +
            "var p={requestId:$rid,success:$successJs,text:$textJs,error:$errJs};" +
            "window.__keugeLastOcrPayload=p;" +
            "if(window.console)console.log('[KeugeOcr] deliver',p.requestId,p.success,(p.text||'').length);" +
            "if(window.KeugeOcr&&window.KeugeOcr._complete){window.KeugeOcr._complete(p);}" +
            "if(window.__keugeForceShowResult){window.__keugeForceShowResult(p);}" +
            "}catch(e){if(window.console)console.error('[KeugeOcr] deliver error',e);}})();"

        Log.d(
            TAG,
            "deliverOcrResult: requestId=$requestId success=$success " +
                "textLen=${text?.length ?: 0} error=$error"
        )
        runJsOnWebView(js)
    }

    private fun runJsOnWebView(js: String) {
        activity.runOnUiThread {
            try {
                webView.evaluateJavascript(js) { result ->
                    Log.d(TAG, "evaluateJavascript done result=$result")
                }
            } catch (e: Exception) {
                Log.e(TAG, "evaluateJavascript failed", e)
            }
            // 긴 OCR 텍스트·base64는 loadUrl 한도 초과 → evaluateJavascript만 사용
            if (js.length <= 180_000) {
                try {
                    webView.loadUrl("javascript:$js")
                } catch (e: Exception) {
                    Log.e(TAG, "loadUrl(javascript:) failed", e)
                }
            } else {
                Log.w(TAG, "runJsOnWebView: skip loadUrl (script too long ${js.length})")
            }
        }
    }

    private fun jsStringLiteral(src: String): String {
        val sb = StringBuilder(src.length + 16)
        sb.append('\'')
        for (c in src) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '\'' -> sb.append("\\'")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\u2028' -> sb.append("\\u2028")
                '\u2029' -> sb.append("\\u2029")
                else -> sb.append(c)
            }
        }
        sb.append('\'')
        return sb.toString()
    }

    fun destroy() {
        ttsManager.shutdown()
        sttManager.destroy()
    }

    companion object {
        private const val TAG = "KeugeBridge"
    }
}
