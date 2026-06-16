package com.siinseon.keuge

import android.util.Log
import android.webkit.JavascriptInterface

class WebAppInterface(
    private val speakHandler: (String) -> Unit,
    private val stopHandler: () -> Unit,
    private val readyChecker: () -> Boolean,
    private val ocrHandler: (String, String) -> Unit
) {

    @JavascriptInterface
    fun speakText(text: String) {
        speakHandler(text)
    }

    @JavascriptInterface
    fun stopSpeak() {
        stopHandler()
    }

    @JavascriptInterface
    fun isTtsReady(): Boolean = readyChecker()

    @JavascriptInterface
    fun recognizeTextFromBase64(requestId: String, imageBase64: String) {
        Log.d("OCR", "recognizeTextFromBase64 requestId=$requestId base64Len=${imageBase64.length}")
        ocrHandler(requestId, imageBase64)
    }
}
