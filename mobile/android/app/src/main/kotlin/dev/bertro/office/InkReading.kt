package dev.bertro.office

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizer
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.recognition.Ink
import com.google.mlkit.vision.digitalink.recognition.RecognitionContext
import com.google.mlkit.vision.digitalink.recognition.WritingArea
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray

// What a drawing says, read on the tablet itself – the web app's `window.sliderInk`
// (`apps/web/src/features/pages/lib/ink-read.ts`), with Google's ML Kit (digital ink: the strokes,
// not a picture of them). The model comes from Google once per language; the strokes stay here.

/** One point of a stroke, in the drawing's 1000-wide frame (y grows downwards). */
data class InkPoint(val x: Float, val y: Float)

/** One line of writing: its strokes as drawn, each its points. */
typealias InkLine = List<List<InkPoint>>

class ReadError(message: String) : Exception(message)

suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { done ->
  addOnSuccessListener { done.resume(it) }
  addOnFailureListener { done.resumeWithException(it) }
  addOnCanceledListener { done.cancel() }
}

/** `[[[{x, y}, …], …], …]` – the lines as the page sends them. */
fun parseLines(json: JSONArray): List<InkLine> =
  (0 until json.length()).map { l ->
    val line = json.getJSONArray(l)
    (0 until line.length()).map { s ->
      val stroke = line.getJSONArray(s)
      (0 until stroke.length()).map { p ->
        val point = stroke.getJSONObject(p)
        InkPoint(point.getDouble("x").toFloat(), point.getDouble("y").toFloat())
      }
    }
  }

/** Reads handwriting – one text per line, `""` where a line says nothing. */
object InkReader {
  private val models = RemoteModelManager.getInstance()
  private val recognizers = mutableMapOf<String, DigitalInkRecognizer>()

  /** `de` → `de-DE`: the page's language as ML Kit names its models; German if none fits. */
  fun modelOf(languages: List<String>): DigitalInkRecognitionModel {
    for (tag in languages + "de") {
      val base = tag.substringBefore('-')
      val id =
        runCatching { DigitalInkRecognitionModelIdentifier.fromLanguageTag(tag) }.getOrNull()
          ?: runCatching { DigitalInkRecognitionModelIdentifier.fromLanguageTag("$base-${base.uppercase()}") }
            .getOrNull()
          ?: runCatching { DigitalInkRecognitionModelIdentifier.fromLanguageTag(base) }.getOrNull()
      if (id != null) return DigitalInkRecognitionModel.builder(id).build()
    }
    throw ReadError("Für diese Sprache gibt es keine Handschrift-Erkennung.")
  }

  /** The model on the device – from Google the first time (any network). */
  suspend fun fetch(languages: List<String>): DigitalInkRecognitionModel {
    val model = modelOf(languages)
    if (!models.isModelDownloaded(model).await()) {
      try {
        models.download(model, DownloadConditions.Builder().build()).await()
      } catch (error: Exception) {
        throw ReadError("Die Handschrift-Erkennung lädt beim ersten Mal aus dem Netz – gerade ohne Verbindung.")
      }
    }
    return model
  }

  suspend fun read(lines: List<InkLine>, languages: List<String>): List<String> {
    val model = fetch(languages)
    val recognizer =
      synchronized(recognizers) {
        recognizers.getOrPut(model.modelIdentifier.languageTag) {
          DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build())
        }
      }
    return coroutineScope { lines.map { line -> async { readLine(recognizer, line) } }.awaitAll() }
  }

  private suspend fun readLine(recognizer: DigitalInkRecognizer, line: InkLine): String {
    val points = line.flatten()
    if (points.isEmpty()) return ""
    // No times come with the strokes: one point after another, as drawn.
    var time = 0L
    val ink = Ink.builder()
    for (stroke in line) {
      if (stroke.isEmpty()) continue
      val built = Ink.Stroke.builder()
      for (point in stroke) built.addPoint(Ink.Point.create(point.x, point.y, time.also { time += 10 }))
      ink.addStroke(built.build())
      time += 100
    }
    val height = points.maxOf { it.y } - points.minOf { it.y }
    val context =
      RecognitionContext.builder()
        .setPreContext("")
        .setWritingArea(WritingArea(1000f, maxOf(height * 1.5f, 1f)))
        .build()
    val result = recognizer.recognize(ink.build(), context).await()
    return result.candidates.firstOrNull()?.text?.trim() ?: ""
  }
}
