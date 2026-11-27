plugins {
  id("com.android.application")
}

android {
  namespace = "dev.bertro.office"
  compileSdk = 37

  defaultConfig {
    applicationId = "dev.bertro.office"
    minSdk = 29
    targetSdk = 37
    versionCode = 1
    versionName = "0.1.0"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
    }
  }

  buildFeatures {
    buildConfig = true
  }
}

dependencies {
  implementation("com.google.mlkit:digital-ink-recognition:19.0.0")
  implementation("androidx.webkit:webkit:1.18.0")
  implementation("androidx.browser:browser:1.10.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
}
