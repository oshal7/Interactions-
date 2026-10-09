package io.github.oshal7.papersky

import android.app.KeyguardManager
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.service.wallpaper.WallpaperService
import android.view.MotionEvent
import android.view.SurfaceHolder

/** Settings shared by the app screen and the wallpaper (same process, plain SharedPreferences). */
class Prefs(context: Context) {
    val sp: SharedPreferences = context.getSharedPreferences("paper_sky", Context.MODE_PRIVATE)
    var mood: String
        get() = sp.getString("mood", "dusk") ?: "dusk"
        set(v) = sp.edit().putString("mood", v).apply()
    var planes: Int
        get() = sp.getInt("planes", 26)
        set(v) = sp.edit().putInt("planes", v).apply()
    var trails: Boolean
        get() = sp.getBoolean("trails", true)
        set(v) = sp.edit().putBoolean("trails", v).apply()
    var lowPower: Boolean
        get() = sp.getBoolean("lowPower", false)
        set(v) = sp.edit().putBoolean("lowPower", v).apply()
    var follow: Boolean
        get() = sp.getBoolean("follow", true)
        set(v) = sp.edit().putBoolean("follow", v).apply()

    fun applyTo(sky: Sky) {
        sky.mood = Mood.of(mood)
        sky.planeCount = planes
        sky.trails = trails
        sky.follow = follow
    }
}

/**
 * The live wallpaper. Android shows it on the home screen and (if you pick "Home and lock screens")
 * on the lock screen. Home screen: touches reach the wallpaper, so planes follow your finger.
 * Lock screen: the system keeps touches for itself, so an invisible hand draws slow loops instead.
 * Your PIN / pattern / fingerprint are untouched: they belong to Android.
 */
class PaperSkyWallpaperService : WallpaperService() {

    override fun onCreateEngine(): Engine = SkyEngine()

    inner class SkyEngine : Engine(), SharedPreferences.OnSharedPreferenceChangeListener {
        private val handler = Handler(Looper.getMainLooper())
        private val sky = Sky(resources.displayMetrics.density)
        private val prefs = Prefs(this@PaperSkyWallpaperService)
        private val keyguard = getSystemService(KeyguardManager::class.java)
        private val power = getSystemService(PowerManager::class.java)
        private var visible = false
        private var lastNs = 0L

        private val frame = object : Runnable {
            override fun run() {
                drawFrame()
                if (visible) handler.postDelayed(this, frameDelayMs())
            }
        }

        override fun onCreate(surfaceHolder: SurfaceHolder) {
            super.onCreate(surfaceHolder)
            setTouchEventsEnabled(true)
            setOffsetNotificationsEnabled(true)
            prefs.applyTo(sky)
            prefs.sp.registerOnSharedPreferenceChangeListener(this)
        }

        override fun onDestroy() {
            handler.removeCallbacks(frame)
            prefs.sp.unregisterOnSharedPreferenceChangeListener(this)
            super.onDestroy()
        }

        override fun onSharedPreferenceChanged(sp: SharedPreferences?, key: String?) {
            prefs.applyTo(sky)
        }

        override fun onSurfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
            super.onSurfaceChanged(holder, format, width, height)
            sky.resize(width, height)
            lastNs = System.nanoTime()
            drawFrame()
        }

        override fun onSurfaceDestroyed(holder: SurfaceHolder) {
            visible = false
            handler.removeCallbacks(frame)
            super.onSurfaceDestroyed(holder)
        }

        // Only animate while someone can see it: this is what keeps battery use low.
        override fun onVisibilityChanged(isVisible: Boolean) {
            visible = isVisible
            handler.removeCallbacks(frame)
            if (isVisible) {
                lastNs = System.nanoTime()
                handler.post(frame)
            } else {
                sky.release()
            }
        }

        override fun onTouchEvent(event: MotionEvent) {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> sky.touch(event.x, event.y, true)
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> sky.release()
            }
        }

        // Home-screen page swipes: a gentle parallax.
        override fun onOffsetsChanged(xOffset: Float, yOffset: Float, xStep: Float, yStep: Float, xPixels: Int, yPixels: Int) {
            sky.parallax = xOffset - 0.5f
        }

        private fun lowPower() = prefs.lowPower || power?.isPowerSaveMode == true
        private fun frameDelayMs() = if (lowPower()) 50L else 33L       // 20 fps or 30 fps

        private fun drawFrame() {
            val now = System.nanoTime()
            val dt = ((now - lastNs) / 1e9f).coerceIn(0f, 0.05f)
            lastNs = now
            sky.autopilot = keyguard?.isKeyguardLocked == true
            sky.step(dt)

            val holder = surfaceHolder
            var canvas: Canvas? = null
            try {
                canvas = try { holder.lockHardwareCanvas() } catch (e: Exception) { holder.lockCanvas() }
                if (canvas != null) sky.draw(canvas)
            } catch (_: Exception) {
                // surface went away mid-frame; the next visibility change restarts us
            } finally {
                if (canvas != null) {
                    try { holder.unlockCanvasAndPost(canvas) } catch (_: Exception) { }
                }
            }
        }
    }
}
