package com.siinseon.keuge

import android.content.Context
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale

class NativeTtsManager(context: Context) {

    private var engine: TextToSpeech? = null
    var isReady: Boolean = false
        private set

    init {
        engine = TextToSpeech(context) { status ->
            if (status != TextToSpeech.SUCCESS) {
                isReady = false
                Log.e(TAG, "TextToSpeech initialization failed: $status")
                return@TextToSpeech
            }

            val tts = engine ?: return@TextToSpeech
            var langResult = tts.setLanguage(Locale.forLanguageTag("ko-KR"))
            if (
                langResult == TextToSpeech.LANG_MISSING_DATA ||
                langResult == TextToSpeech.LANG_NOT_SUPPORTED
            ) {
                langResult = tts.setLanguage(Locale.KOREAN)
            }
            if (
                langResult == TextToSpeech.LANG_MISSING_DATA ||
                langResult == TextToSpeech.LANG_NOT_SUPPORTED
            ) {
                isReady = false
                Log.e(TAG, "Korean TTS language is not supported")
                return@TextToSpeech
            }

            tts.setSpeechRate(0.9f)
            tts.setPitch(1.0f)
            isReady = true
        }
    }

    fun speak(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || !isReady) return

        engine?.stop()
        engine?.speak(
            trimmed,
            TextToSpeech.QUEUE_FLUSH,
            null,
            "keuge_${System.currentTimeMillis()}"
        )
    }

    fun stop() {
        engine?.stop()
    }

    fun shutdown() {
        engine?.stop()
        engine?.shutdown()
        engine = null
        isReady = false
    }

    companion object {
        private const val TAG = "KeugeTTS"
    }
}
