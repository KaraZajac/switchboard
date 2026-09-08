package org.switchboard.android.ui

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import org.switchboard.android.pairing.PairingPayload
import org.switchboard.android.pairing.Pairing
import org.switchboard.android.pairing.QrScanner
import java.util.concurrent.Executors

/**
 * Point the phone at the desktop.
 *
 * The QR carries the ticket and the code together, so a scan is the whole of
 * pairing — no six digits to read off one screen and type into another. What
 * makes that safe is that a QR is read off the screen in front of you and the
 * desktop only accepts it for five minutes.
 */
@Composable
fun ScannerScreen(
    onScanned: (PairingPayload) -> Unit,
    onEnterManually: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(hasCamera(context)) }
    var failure by remember { mutableStateOf<String?>(null) }
    var found by remember { mutableStateOf(false) }

    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        if (!it) failure = "Switchboard needs the camera to read the pairing code."
    }

    LaunchedEffect(Unit) {
        if (!granted) ask.launch(Manifest.permission.CAMERA)
    }

    Column(modifier = Modifier.fillMaxSize().background(Crust)) {
        Row(
            modifier = Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 6.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = Subtext,
                modifier = Modifier.size(44.dp).clickable(onClick = onBack).padding(11.dp)
            )
            Text("Scan to pair", color = Text0, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }

        Box(
            modifier = Modifier.fillMaxWidth().weight(1f),
            contentAlignment = Alignment.Center
        ) {
            when {
                failure != null -> Text(
                    failure!!,
                    color = Subtext,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    modifier = Modifier.padding(32.dp)
                )

                granted -> {
                    CameraPreview(
                        enabled = !found,
                        onText = { text ->
                            if (found) return@CameraPreview
                            val payload = Pairing.parse(text) ?: return@CameraPreview
                            found = true
                            onScanned(payload)
                        },
                        onUnavailable = {
                            // A tablet with no back camera, a device where
                            // another app holds it, an emulator with none
                            // configured. Silence here is a black rectangle the
                            // user waits at forever.
                            failure = "No camera is available on this device. " +
                                "You can still pair by entering the code below."
                        }
                    )
                    ScanReticle()
                }

                else -> Text(
                    "Waiting for camera permission…",
                    color = Subtext,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(32.dp)
                )
            }
        }

        Column(
            modifier = Modifier.fillMaxWidth().background(Crust).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                when {
                    found -> "Found it — pairing…"
                    failure != null -> "Pairing by hand instead"
                    else -> "Point the camera at the QR code on your desktop"
                },
                color = if (found) Green else Subtext,
                fontSize = 14.sp
            )
            Spacer(Modifier.height(4.dp))
            Text(
                "Settings → Devices → Pair a device",
                color = Overlay,
                fontSize = 12.sp
            )
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = onEnterManually,
                colors = ButtonDefaults.buttonColors(containerColor = Surface0, contentColor = Text0),
                shape = RoundedCornerShape(10.dp)
            ) {
                Text("Enter the code instead", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** The frame that tells you where to aim, and nothing else */
@Composable
private fun ScanReticle() {
    Box(
        modifier = Modifier
            .fillMaxWidth(0.72f)
            .aspectRatio(1f)
            .clip(RoundedCornerShape(20.dp))
            .background(androidx.compose.ui.graphics.Color.Transparent)
    ) {
        val corner = Modifier.size(34.dp)
        val thickness = 3.dp
        // Four corner brackets, drawn as pairs of bars
        listOf(
            Alignment.TopStart to (true to true),
            Alignment.TopEnd to (false to true),
            Alignment.BottomStart to (true to false),
            Alignment.BottomEnd to (false to false)
        ).forEach { (alignment, sides) ->
            val (left, top) = sides
            Box(modifier = Modifier.align(alignment).then(corner)) {
                Box(
                    Modifier
                        .align(if (top) Alignment.TopStart else Alignment.BottomStart)
                        .fillMaxWidth()
                        .height(thickness)
                        .background(Blue)
                )
                Box(
                    Modifier
                        .align(if (left) Alignment.TopStart else Alignment.TopEnd)
                        .width(thickness)
                        .fillMaxSize()
                        .background(Blue)
                )
            }
        }
    }
}

@Composable
private fun CameraPreview(
    enabled: Boolean,
    onText: (String) -> Unit,
    onUnavailable: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scanner = remember { QrScanner() }
    val executor = remember { Executors.newSingleThreadExecutor() }

    DisposableEffect(Unit) {
        onDispose { executor.shutdown() }
    }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { ctx ->
            val previewView = PreviewView(ctx).apply {
                scaleType = PreviewView.ScaleType.FILL_CENTER
            }
            val providerFuture = ProcessCameraProvider.getInstance(ctx)

            providerFuture.addListener({
                val provider = runCatching { providerFuture.get() }.getOrNull()
                if (provider == null) {
                    onUnavailable()
                    return@addListener
                }

                val preview = Preview.Builder().build().also {
                    it.surfaceProvider = previewView.surfaceProvider
                }

                val analysis = ImageAnalysis.Builder()
                    // Only the newest frame matters; a backlog would decode
                    // images of where the phone used to be pointing.
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()

                analysis.setAnalyzer(executor) { image ->
                    try {
                        if (enabled) scanner.decode(image)?.let(onText)
                    } finally {
                        image.close()
                    }
                }

                // Prefer the back camera, but a front-facing one still reads a
                // code held up to it — better than refusing outright.
                val bound = listOf(
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    CameraSelector.DEFAULT_FRONT_CAMERA
                ).any { selector ->
                    runCatching {
                        provider.unbindAll()
                        provider.bindToLifecycle(lifecycleOwner, selector, preview, analysis)
                    }.isSuccess
                }

                if (!bound) onUnavailable()
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        }
    )
}

private fun hasCamera(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED
