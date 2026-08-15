package com.siinseon.keuge

import android.content.Context
import android.net.Uri
import android.util.Log
import com.google.mlkit.vision.common.InputImage

object NativeOcrManager {

    private const val TAG = "KeugeNativeOcr"

    fun recognizeImageUri(context: Context, uri: Uri): String {
        Log.d(TAG, "recognizeImageUri: $uri")
        val image = InputImage.fromFilePath(context, uri)
        return OcrProcessor.recognizeImage(image)
    }
}
