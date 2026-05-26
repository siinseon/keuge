package com.keuge.app

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.TextRecognition
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

object OcrProcessor {

    private val recognizer by lazy {
        TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
    }

    fun recognizeBitmap(bitmap: Bitmap): String {
        val image = InputImage.fromBitmap(bitmap, 0)
        val latch = CountDownLatch(1)
        var resultText = ""
        var error: Exception? = null

        recognizer.process(image)
            .addOnSuccessListener { visionText ->
                resultText = visionText.text.trim()
                latch.countDown()
            }
            .addOnFailureListener { e ->
                error = e
                latch.countDown()
            }

        if (!latch.await(30, TimeUnit.SECONDS)) {
            throw RuntimeException("timeout")
        }
        error?.let { throw it }
        return resultText
    }
}
