package com.keuge.app

import android.graphics.Bitmap
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import java.util.concurrent.TimeUnit

object OcrProcessor {

    private const val TAG = "KeugeOcrProc"
    private const val TIMEOUT_SECONDS = 30L

    private val recognizer by lazy {
        TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
    }

    /**
     * 동기적으로 ML Kit OCR을 실행한다. 호출 스레드는 워커 스레드여야 한다.
     *
     * 이전에는 CountDownLatch + addOnSuccessListener 조합을 사용했는데,
     * 일부 단말에서 리스너 콜백이 메인 스레드에 디스패치되지 않거나 지연되어
     * latch.await 가 timeout으로 끝나는 사례가 있었다.
     * Tasks.await 는 Task 가 끝날 때까지 호출 스레드를 직접 블록하며,
     * 내부 콜백 디스패치에 의존하지 않으므로 신뢰성이 높다.
     */
    fun recognizeBitmap(bitmap: Bitmap): String {
        Log.d(TAG, "recognizeBitmap: ${bitmap.width}x${bitmap.height}")
        val image = InputImage.fromBitmap(bitmap, 0)
        return recognizeImage(image)
    }

    fun recognizeImage(image: InputImage): String {
        val task = recognizer.process(image)
        val visionText = try {
            Tasks.await(task, TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (e: Exception) {
            Log.e(TAG, "Tasks.await failed", e)
            throw e
        }
        val text = visionText.text.trim()
        Log.d(TAG, "recognizeBitmap: result length=${text.length}")
        return text
    }
}
