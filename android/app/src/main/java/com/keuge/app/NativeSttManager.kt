package com.keuge.app

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log

/**
 * Android 네이티브 SpeechRecognizer 래퍼.
 * JS → startVoiceSearch / stopVoiceSearch 브리지 호출을 처리하고,
 * 결과를 onResult / onError 콜백으로 WebAppBridge에 전달한다.
 */
class NativeSttManager(private val activity: MainActivity) {

    private var recognizer: SpeechRecognizer? = null
    private var currentRequestId: String? = null
    private var onResult: ((requestId: String, transcript: String) -> Unit)? = null
    private var onError: ((requestId: String, error: String) -> Unit)? = null

    fun isAvailable(): Boolean =
        SpeechRecognizer.isRecognitionAvailable(activity)

    fun start(
        requestId: String,
        onResult: (String, String) -> Unit,
        onError: (String, String) -> Unit
    ) {
        this.onResult = onResult
        this.onError = onError
        this.currentRequestId = requestId

        activity.runOnUiThread {
            try {
                recognizer?.destroy()
                recognizer = SpeechRecognizer.createSpeechRecognizer(activity)
                recognizer?.setRecognitionListener(makeListener(requestId))

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                    )
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                }
                recognizer?.startListening(intent)
                Log.d(TAG, "STT startListening requestId=$requestId")
            } catch (e: Exception) {
                Log.e(TAG, "STT start failed", e)
                val rid = currentRequestId ?: requestId
                currentRequestId = null
                onError(rid, e.message ?: "start_failed")
            }
        }
    }

    fun stop() {
        activity.runOnUiThread {
            try {
                recognizer?.stopListening()
                Log.d(TAG, "STT stopListening")
            } catch (e: Exception) {
                Log.e(TAG, "STT stop failed", e)
            }
        }
    }

    fun destroy() {
        activity.runOnUiThread {
            try {
                recognizer?.destroy()
                recognizer = null
                Log.d(TAG, "STT destroyed")
            } catch (e: Exception) {
                Log.e(TAG, "STT destroy failed", e)
            }
        }
    }

    private fun makeListener(fallbackRequestId: String) = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            Log.d(TAG, "STT onReadyForSpeech")
        }

        override fun onBeginningOfSpeech() {
            Log.d(TAG, "STT onBeginningOfSpeech")
        }

        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {
            Log.d(TAG, "STT onEndOfSpeech")
        }

        override fun onError(error: Int) {
            val msg = sttErrorCode(error)
            Log.w(TAG, "STT onError: $error → $msg")
            val rid = currentRequestId ?: fallbackRequestId
            currentRequestId = null
            onError?.invoke(rid, msg)
        }

        override fun onResults(results: Bundle?) {
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val transcript = matches?.firstOrNull()?.trim() ?: ""
            Log.d(TAG, "STT onResults: \"$transcript\"")
            val rid = currentRequestId ?: fallbackRequestId
            currentRequestId = null
            if (transcript.isNotBlank()) {
                onResult?.invoke(rid, transcript)
            } else {
                onError?.invoke(rid, "empty_result")
            }
        }

        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun sttErrorCode(error: Int): String = when (error) {
        SpeechRecognizer.ERROR_AUDIO -> "audio_error"
        SpeechRecognizer.ERROR_CLIENT -> "client_error"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "no_permission"
        SpeechRecognizer.ERROR_NETWORK -> "network_error"
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network_timeout"
        SpeechRecognizer.ERROR_NO_MATCH -> "no_match"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "recognizer_busy"
        SpeechRecognizer.ERROR_SERVER -> "server_error"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "speech_timeout"
        else -> "error_$error"
    }

    companion object {
        private const val TAG = "KeugeStt"
    }
}
