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

        // 핵심: 결과를 JS 코드 안에 그대로 인라인하면 OCR 텍스트에 포함된
        // 줄바꿈(\u2028, \u2029 등) / 따옴표로 JS 파싱이 깨질 수 있다.
        // 안전하게 JSON 문자열로 만들어 JS의 JSON.parse 로 복원한다.
        val payloadJson = payload.toString()
        val jsLiteral = jsStringLiteral(payloadJson)

        // 추가 안전망:
        //   1) window.__keugeLastOcrPayload 에 항상 결과를 저장한다.
        //      _complete 가 어떤 이유로든 모달을 표시하지 못하면 JS 쪽 폴러가
        //      이 값을 읽어 강제로 결과 모달을 띄울 수 있게 한다.
        //   2) _complete 호출은 try/catch 로 감싸 한 곳이 실패해도 다른 흐름은 진행되게 한다.
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

        // 메인 스레드에서 두 가지 채널 모두 시도한다.
        activity.runOnUiThread {
            // 채널 1: evaluateJavascript (정식 경로)
            webView.evaluateJavascript(js) { result ->
                Log.d(TAG, "deliverOcrResult: evaluateJavascript result=$result")
            }
            // 채널 2: loadUrl("javascript:...") (구형 fallback). 일부 단말/상태에서
            //         evaluateJavascript 가 silent fail 하는 경우를 대비한다.
            try {
                webView.loadUrl("javascript:$js")
            } catch (e: Exception) {
                Log.e(TAG, "loadUrl(javascript:) failed", e)
            }
        }
    }

    /** Kotlin String → 안전한 JS 문자열 리터럴(작은따옴표로 감쌈). */
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
