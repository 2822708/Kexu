import java.util.Properties

plugins { id("com.android.application") }

val signing = Properties()
val signingFile = rootProject.file(providers.environmentVariable("KEXU_ANDROID_SIGNING_PROPERTIES").orNull ?: "signing.properties")
if (signingFile.exists()) signingFile.inputStream().use { signing.load(it) }

android {
    namespace = "com.kexu.local"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.kexu.local"
        minSdk = 26
        targetSdk = 36
        versionCode = 2026101901
        versionName = "2026.10.19"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    if (signingFile.exists()) {
        signingConfigs.create("localRelease") {
            storeFile = file(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (signingFile.exists()) signingConfig = signingConfigs.getByName("localRelease")
        }
    }
}

dependencies {
    implementation("androidx.activity:activity:1.12.1")
    implementation("androidx.webkit:webkit:1.16.0")
    testImplementation("junit:junit:4.13.2")
}

tasks.register("verifyWebAssets") {
    doLast {
        val assetRoot = file("src/main/assets/www")
        check(file("src/main/assets/shell-assets.txt").isFile) { "Run scripts/android-shell/Build-AndroidShell.ps1 first." }
        val index = File(assetRoot, "index.html")
        check(index.isFile && !index.readText().contains("manifest.webmanifest")) { "Expected build:shell assets, without PWA manifest." }
        check(!File(assetRoot, "sw.js").exists()) { "Service worker must not be packaged in native shell." }
    }
}
tasks.named("preBuild") { dependsOn("verifyWebAssets") }
