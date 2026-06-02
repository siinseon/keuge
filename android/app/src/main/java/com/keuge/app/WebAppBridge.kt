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

    /** 갤러리/최근 사진에서 이미지 선택 후 ML Kit OCR */
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
        if (requestId.isNullOrBlank() || base64.isNullOrBlank()) return
        activity.runOnUiThread {
            activity.runOcrOnBase64(requestId, base64)
        }
    }

    fun deliverOcrResult(
        requestId: String,
        success: Boolean,
        text: String?,
        error: String?
    ) {
        val payload = JSONObject().apply {
            put("requestId", requestId)
            put("success", success)
            if (!text.isNullOrBlank()) put("text", text)
            if (!error.isNullOrBlank()) put("error", error)
        }

        val payloadJson = payload.toString()
        val jsLiteral = jsStringLiteral(payloadJson)

        val js = "(function(){try{" +
            "var p=JSON.parse($jsLiteral);" +
            "window.__keugeLastOcrPayload=p;" +
            "if(window.console)console.log('[KeugeOcr] deliver',p);" +
            "try{if(window.KeugeOcr&&typeof window.KeugeOcr._complete==='function'){" +
            "window.KeugeOcr._complete(p);}}catch(e1){if(window.console)console.error('[KeugeOcr] _complete threw',e1);}" +
            "try{if(typeof window.__keugeForceShowResult==='function'){" +
            "window.__keugeForceShowResult(p);}}catch(e2){if(window.console)console.error('[KeugeOcr] forceShow threw',e2);}" +
            "}catch(e){if(window.console)console.error('[KeugeOcr] deliver error',e);}})();"

        Log.d(
            TAG,
            "deliverOcrResult: requestId=$requestId success=$success " +
                "textLen=${text?.length ?: 0} error=$error"
        )

        activity.runOnUiThread {
            try {
                webView.evaluateJavascript(js) { result ->
                    Log.d(TAG, "deliverOcrResult: evaluateJavascript result=$result")
                }
            } catch (e: Exception) {
                Log.e(TAG, "deliverOcrResult evaluateJavascript failed", e)
            }
            try {
                webView.loadUrl("javascript:$js")
            } catch (e: Exception) {
                Log.e(TAG, "deliverOcrResult loadUrl failed", e)
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
