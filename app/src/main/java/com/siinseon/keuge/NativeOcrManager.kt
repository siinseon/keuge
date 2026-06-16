package com.siinseon.keuge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class NativeOcrManager {

    private val recognizer = TextRecognition.getClient(
        KoreanTextRecognizerOptions.Builder().build()
    )
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()

    fun recognizeFromBase64(
        imageBase64: String,
        onSuccess: (String) -> Unit,
        onFailure: (String) -> Unit
    ) {
        executor.execute {
            try {
                Log.d("OCR", "ML Kit process start (executor)")
                val bytes = Base64.decode(imageBase64, Base64.DEFAULT)
                if (bytes.isEmpty()) {
                    Log.d("OCR", "decode bitmap fail: empty bytes")
                    onFailure("empty_image")
                    return@execute
                }

                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                if (bitmap == null) {
                    Log.d("OCR", "decode bitmap fail: BitmapFactory returned null")
                    onFailure("invalid_image")
                    return@execute
                }
                Log.d("OCR", "decode bitmap success w=${bitmap.width} h=${bitmap.height}")

                val image = InputImage.fromBitmap(bitmap, 0)
                recognizer.process(image)
                    .addOnSuccessListener { result ->
                        Log.d("OCR", "ML Kit onSuccess callback len=${result.text.length}")
                        bitmap.recycle()
                        val text = result.text.trim()
                        if (text.isEmpty()) {
                            Log.d("OCR", "ML Kit success but empty_text")
                            onFailure("empty_text")
                        } else {
                            onSuccess(text)
                        }
                    }
                    .addOnFailureListener { error ->
                        Log.d("OCR", "ML Kit onFailure callback ${error.message}")
                        bitmap.recycle()
                        onFailure(error.message ?: "ocr_failed")
                    }
            } catch (e: Exception) {
                Log.d("OCR", "ML Kit executor exception ${e.message}")
                onFailure(e.message ?: "ocr_failed")
            }
        }
    }

    fun shutdown() {
        recognizer.close()
        executor.shutdown()
    }
}
