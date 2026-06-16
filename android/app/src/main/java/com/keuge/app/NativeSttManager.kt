package com.keuge.app

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
    @Volatile private var currentRequestId: String? = null
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
            // 기기에서 음성 인식 서비스 자체가 없는 경우 조기 반환
            if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
                Log.e(TAG, "STT: isRecognitionAvailable = false")
                val rid = currentRequestId ?: requestId
                currentRequestId = null
                val cb = this.onError
                this.onResult = null
                this.onError = null
                cb?.invoke(rid, "not_available")
                return@runOnUiThread
            }

            try {
                // 이전 세션 해제
                recognizer?.destroy()
                recognizer = null

                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                    )
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ko-KR")
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                    // 음성 종료 판정 임계값 (일부 기기에서 너무 빨리 종료되는 문제 완화)
                    putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
                    putExtra(
                        RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
                        1000L
                    )
                }

                // destroy() 직후 즉시 createSpeechRecognizer + startListening 하면
                // 인식 서비스가 리소스를 미해제한 상태에서 새 세션이 열려 ERROR_CLIENT(5) 발생.
                // 100ms 지연으로 서비스 안정화 후 시작.
                Handler(Looper.getMainLooper()).postDelayed({
                    // 지연 동안 새 요청이 들어왔거나 취소됐으면 중단
                    if (currentRequestId != requestId) return@postDelayed
                    try {
                        val sr = SpeechRecognizer.createSpeechRecognizer(activity)
                        sr.setRecognitionListener(makeListener(requestId))
                        sr.startListening(intent)
                        recognizer = sr
                        Log.d(TAG, "STT startListening requestId=$requestId")
                    } catch (e: Exception) {
                        Log.e(TAG, "STT startListening (delayed) failed", e)
                        val rid = currentRequestId ?: requestId
                        currentRequestId = null
                        val cb = this.onError
                        this.onResult = null
                        this.onError = null
                        cb?.invoke(rid, "start_failed")
                    }
                }, 100L)

            } catch (e: Exception) {
                Log.e(TAG, "STT start failed", e)
                val rid = currentRequestId ?: requestId
                currentRequestId = null
                val cb = this.onError
                this.onResult = null
                this.onError = null
                cb?.invoke(rid, "start_failed")
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
            // 사용자가 요청한 로그 형식 (logcat 필터: tag=STT)
            Log.d("STT", "error = $error")
            val msg = sttErrorCode(error)
            Log.w(TAG, "STT onError: $error ($msg)")
            val rid = currentRequestId ?: fallbackRequestId
            currentRequestId = null
            val cb = onError
            onResult = null
            onError = null
            // 에러 코드 숫자를 함께 전달해 JS 토스트에서 상세 표시
            cb?.invoke(rid, "$msg:$error")
        }

        override fun onResults(results: Bundle?) {
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val transcript = matches?.firstOrNull()?.trim() ?: ""
            Log.d(TAG, "STT onResults: \"$transcript\"")
            val rid = currentRequestId ?: fallbackRequestId
            currentRequestId = null
            val resultCb = onResult
            val errorCb = onError
            onResult = null
            onError = null
            if (transcript.isNotBlank()) {
                resultCb?.invoke(rid, transcript)
            } else {
                errorCb?.invoke(rid, "empty_result:0")
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
        else -> "error"
    }

    companion object {
        private const val TAG = "KeugeStt"
    }
}
