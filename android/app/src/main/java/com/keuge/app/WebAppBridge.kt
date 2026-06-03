package com.keuge.app

import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

class WebAppBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val onImagePickRequested: (requestId: String) -> Unit
) {

    private val ttsManager = NativeTtsManager(activity)

    @JavascriptInterface
    fun speakText(text: String?) {
        ttsManager.speak(text)
    }

    @JavascriptInterface
    fun stopSpeak() {
        ttsManager.stop()
    }

    @JavascriptInterface
    fun isTtsReady(): Boolean = ttsManager.isReady()

    /** WebView file:// 에서 fetch 불가 — assets 의 brands.json 전체를 동기 반환 */
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

    /** 갤러리/최근 사진 선택 (미리보기만, OCR은 recognizeMenuImage) */
    @JavascriptInterface
    fun selectMenuImage(requestId: String?) {
        if (requestId.isNullOrBlank()) {
            Log.w(TAG, "selectMenuImage: blank requestId")
            return
        }
        Log.d(TAG, "selectMenuImage: requestId=$requestId")
        activity.runOnUiThread {
            onImagePickRequested(requestId)
        }
    }

    /** 레거시: base64 JPEG → ML Kit (PC 디버그·호환) */
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
            "if(window.KeugeOcr&&typeof window.KeugeOcr._imagePicked==='function'){" +
            "window.KeugeOcr._imagePicked(p);}}catch(e){if(window.console)console.error('[KeugeOcr] picked',e);}})();"

        Log.d(TAG, "deliverImagePicked: requestId=$requestId success=$success error=$error")
        runJsOnWebView(js)
    }

    fun deliverImagePreview(dataUrl: String) {
        if (dataUrl.isBlank()) return
        val jsLiteral = jsStringLiteral(dataUrl)
        val js = "(function(){try{" +
            "var u=$jsLiteral;" +
            "if(typeof window.__keugeShowMenuPreview==='function'){window.__keugeShowMenuPreview(u);}" +
            "}catch(e){if(window.console)console.error('[KeugeOcr] preview',e);}})();"

        Log.d(TAG, "deliverImagePreview: len=${dataUrl.length}")

        activity.runOnUiThread {
            try {
                webView.evaluateJavascript(js, null)
            } catch (e: Exception) {
                Log.e(TAG, "deliverImagePreview evaluateJavascript failed", e)
            }
        }
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
            "if(window.KeugeOcr&&typeof window.KeugeOcr._complete==='function'){window.KeugeOcr._complete(p);}" +
            "if(typeof window.__keugeForceShowResult==='function'){window.__keugeForceShowResult(p);}" +
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
    }

    companion object {
        private const val TAG = "KeugeBridge"
    }
}
