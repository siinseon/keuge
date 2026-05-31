plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.keuge.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.keuge.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }
}

tasks.register<Copy>("copyWebAssets") {
    from("${rootProject.projectDir.parentFile}") {
        include("index.html")
        include("js/**")
        include("css/**")
        include("data/**")
        include("assets/**")
    }
    into("${projectDir}/src/main/assets/www")
}

tasks.named("preBuild") {
    dependsOn("copyWebAssets")
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.activity:activity-ktx:1.9.1")

    // 시스템 카메라 결과(JPEG)의 회전 메타데이터를 읽기 위해 사용.
    implementation("androidx.exifinterface:exifinterface:1.3.7")

    implementation("com.google.mlkit:text-recognition-korean:16.0.1")
    // ML Kit Task 를 동기적으로 await 하기 위해 사용 (Tasks.await).
    // 보통 ML Kit 가 transitive 로 가져오지만 명시해 둔다.
    implementation("com.google.android.gms:play-services-tasks:18.2.0")
}
