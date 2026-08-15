# Keuge ProGuard Rules

# WebView JavaScript Interface
# @JavascriptInterface 어노테이션이 붙은 메서드는 JS에서 호출되므로 제거/난독화 방지
-keepclassmembers class com.siinseon.keuge.WebAppBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# JavascriptInterface 어노테이션 자체 유지
-keepattributes JavascriptInterface

# WebView 관련 클래스 보존 (난독화 시 이름 변경 방지)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Kotlin 메타데이터 유지 (리플렉션 사용 시 필요)
-keepattributes *Annotation*,Signature,InnerClasses

# ML Kit Text Recognition (이미 포함되어 있을 수 있지만 명시)
-keep class com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**
