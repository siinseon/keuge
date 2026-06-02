package com.keuge.app

import android.speech.tts.TextToSpeech
import java.util.Locale

class NativeTtsManager(
    private val activity: MainActivity
) : TextToSpeech.OnInitListener {

    private var tts: TextToSpeech? = TextToSpeech(activity, this)
    private var ready = false

    override fun onInit(status: Int) {
        ready = status == TextToSpeech.SUCCESS
        if (ready) {
            tts?.language = Locale.KOREAN
        }
    }

    fun speak(text: String?) {
        if (text.isNullOrBlank()) return
        activity.runOnUiThread {
            if (!ready) return@runOnUiThread
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "kkeukbom-tts")
        }
    }

    fun stop() {
        activity.runOnUiThread {
            tts?.stop()
        }
    }

    fun isReady(): Boolean = ready

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        ready = false
    }
}
