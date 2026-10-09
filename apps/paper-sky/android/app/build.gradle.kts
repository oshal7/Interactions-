plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.github.oshal7.papersky"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.oshal7.papersky"
        minSdk = 26           // Android 8.0+: hardware-accelerated wallpaper canvas
        targetSdk = 34
        versionCode = (System.getenv("BUILD_NO") ?: "1").toInt()
        versionName = System.getenv("VERSION") ?: "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the APK can be sideloaded without a Play Store account.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
