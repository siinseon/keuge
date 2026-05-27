package com.keuge.app

import android.content.Context
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.Locale

class WebAppBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val onCaptureRequested: (requestId: String, runOcr: Boolean) -> Unit
) : TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    init {
        tts = TextToSpeech(activity, this)
    }

    override fun onInit(status: Int) {
        ttsReady = status == TextToSpeech.SUCCESS
        if (ttsReady) {
            tts?.language = Locale.KOREAN
        }
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
        activity.runOnUiThread {
            tts?.stop()
        }
    }

    @JavascriptInterface
    fun isTtsReady(): Boolean = ttsReady

    /** CameraX 촬영 + ML Kit OCR (Android 전용) */
    @JavascriptInterface
    fun captureAndRecognize(requestId: String?, runOcr: String?) {
        if (requestId.isNullOrBlank()) return
        val ocr = runOcr != "false"
        activity.runOnUiThread {
            onCaptureRequested(requestId, ocr)
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
        val js = "window.KeugeOcr&&window.KeugeOcr._complete(${payload})"
        webView.post {
            webView.evaluateJavascript(js, null)
        }
    }
}
