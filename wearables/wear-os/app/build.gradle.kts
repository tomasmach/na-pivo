plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val requestedSharedDebugKeystore =
    providers.gradleProperty("sharedDebugKeystore").orNull?.let(::file)
val repositorySharedDebugKeystore = file("../../../android/app/debug.keystore")
val sharedDebugKeystore =
    requestedSharedDebugKeystore
        ?: repositorySharedDebugKeystore.takeIf { it.isFile }

if (requestedSharedDebugKeystore != null) {
    require(requestedSharedDebugKeystore.isFile) {
        "sharedDebugKeystore does not point to a readable keystore file"
    }
}

android {
    namespace = "com.tomasmach.na_pivo.wear"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.tomasmach.na_pivo"
        minSdk = 30
        targetSdk = 37
        versionCode = 1
        versionName = "2.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        val backendUrl =
            providers.gradleProperty("backendUrl").orElse("https://api.na-pivo.cz").get()
        buildConfigField("String", "BACKEND_URL", "\"${backendUrl.replace("\"", "\\\"")}\"")
    }

    signingConfigs {
        if (sharedDebugKeystore != null) {
            create("sharedDebug") {
                storeFile = sharedDebugKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        debug {
            signingConfig =
                sharedDebugKeystore?.let { signingConfigs.getByName("sharedDebug") }
                    ?: signingConfigs.getByName("debug")
            applicationIdSuffix = ""
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            freeCompilerArgs.addAll(
            "-Xjspecify-annotations=strict",
            "-Xtype-enhancement-improvements-strict-mode",
            )
        }
    }

    packaging {
        resources.excludes += setOf(
            "/META-INF/{AL2.0,LGPL2.1}",
            "META-INF/LICENSE.md",
            "META-INF/LICENSE-notice.md",
        )
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.fragment:fragment-ktx:1.8.9")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")

    implementation("androidx.compose.ui:ui:1.11.4")
    implementation("androidx.compose.ui:ui-tooling-preview:1.11.4")
    implementation("androidx.compose.foundation:foundation:1.11.4")
    debugImplementation("androidx.compose.ui:ui-tooling:1.11.4")

    implementation("androidx.wear.compose:compose-foundation:1.6.2")
    implementation("androidx.wear.compose:compose-material3:1.6.2")
    implementation("androidx.wear.compose:compose-navigation:1.6.2")
    implementation("androidx.wear:wear:1.4.0")
    implementation("androidx.wear:wear-input:1.2.0")
    implementation("androidx.wear:wear-ongoing:1.1.0")

    implementation("androidx.wear.tiles:tiles:1.6.2")
    implementation("androidx.wear.protolayout:protolayout:1.4.2")
    implementation("androidx.wear.protolayout:protolayout-material3:1.4.2")
    implementation("androidx.wear.protolayout:protolayout-expression:1.4.2")
    debugImplementation("androidx.wear.tiles:tiles-renderer:1.6.2")

    implementation("androidx.wear.watchface:watchface-complications-data-source-ktx:1.3.0")
    implementation("androidx.datastore:datastore-preferences:1.2.1")
    implementation("com.google.android.gms:play-services-wearable:20.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.11.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    testImplementation("org.json:json:20260719")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4:1.11.4")
    debugImplementation("androidx.compose.ui:ui-test-manifest:1.11.4")
}
