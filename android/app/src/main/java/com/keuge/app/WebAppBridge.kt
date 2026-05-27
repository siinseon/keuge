package com.keuge.app

import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.Locale

class WebAppBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val onCameraRequested: () -> Unit
) : TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    init {
        tts = TextToSpeech(activity, this)
    }

    override fun onInit(status: Int) {
        ttsReady = status == TextToSpeech.SUCCESS
        if (ttsReady) tts?.language = Locale.KOREAN
    }

    @JavascriptInterface
    fun speakText(text: String?) {
        if (text.isNullOrBlank()) return
        activity.runOnUiThread {
            if (!ttsReady) return@runOnUiThread
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "keuge-tts")
        }
    }

    @JavascriptInterface
    fun stopSpeak() {
        activity.runOnUiThread { tts?.stop() }
    }

    @JavascriptInterface
    fun isTtsReady(): Boolean = ttsReady

    /** JS → Android: 카메라 열기 + OCR 요청 */
    @JavascriptInterface
    fun openNativeCamera() {
        activity.runOnUiThread { onCameraRequested() }
    }

    /** Android → JS: OCR 결과 전달 */
    fun deliverResult(success: Boolean, text: String?, error: String?) {
        val successStr = success.toString()
        val textJson  = if (!text.isNullOrBlank())  JSONObject.quote(text)  else "null"
        val errorJson = if (!error.isNullOrBlank()) JSONObject.quote(error) else "null"
        val js = "window.KeugeOcr&&window.KeugeOcr._onResult($successStr,$textJson,$errorJson)"
        webView.post { webView.evaluateJavascript(js, null) }
    }

    fun destroy() {
        tts?.stop()
        tts?.shutdown()
        tts = null
    }
}
