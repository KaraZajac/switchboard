plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "org.switchboard.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "org.switchboard.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 5
        versionName = "2.1.2-beta"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    buildFeatures {
        compose = true
        // For the version in the User-Agent every image request carries
        buildConfig = true
    }

    // One APK per ABI: the iroh native library is ~15 MB per architecture, and a
    // universal build ships all four to every phone.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    /**
     * The network list is the desktop's file, copied rather than duplicated.
     *
     * One list, two clients: a second copy in Kotlin would be one edit away
     * from the two apps disagreeing about where Libera is.
     */
    val shareNetworks by tasks.registering(Copy::class) {
        from(rootProject.file("../src/shared/networks.json"))
        into(layout.projectDirectory.dir("src/main/assets"))
    }
    tasks.named("preBuild") { dependsOn(shareNetworks) }

    testOptions {
        // android.util.Log is the only Android API the protocol layer touches,
        // which is what lets the engine be exercised against a real server from
        // an ordinary JVM test.
        unitTests.isReturnDefaultValues = true

        unitTests.all {
            // The corpus lives in the desktop repo and is read, not copied:
            // one file, two implementations, no room for the two to drift.
            it.systemProperty(
                "switchboard.fixtures",
                rootProject.file("../tests/fixtures").absolutePath
            )
            it.testLogging { events("passed", "failed", "skipped") }
            // A live server to test against, when one is running
            for (key in listOf("switchboard.irc", "switchboard.irc.account", "switchboard.irc.password")) {
                System.getProperty(key)?.let { value -> it.systemProperty(key, value) }
            }
        }
    }
}

dependencies {
    // The same peer-to-peer stack the desktop uses, so the two speak QUIC to
    // each other by public key. iroh-android carries the JNI libraries.
    implementation("computer.iroh:iroh-android:1.1.0")

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Camera preview plus a pure-Java QR decoder. ZXing's core is ~500 KB and
    // needs no Play Services, which matters for a client people sideload.
    implementation("androidx.camera:camera-core:1.4.1")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")
    implementation("com.google.zxing:core:3.5.3")

    // Avatars. Fetching, decoding, caching and cancelling on scroll are each
    // easy to get slightly wrong, and getting any of them wrong in a member
    // list shows up as jank or as a leak. Coil is the Compose-native one and
    // brings its own OkHttp.
    implementation("io.coil-kt:coil-compose:2.7.0")

    testImplementation("junit:junit:4.13.2")
    // Generating a QR in the unit test, so the decoder is checked against a
    // real image rather than a hand-made bitmap
    testImplementation("com.google.zxing:javase:3.5.3")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
