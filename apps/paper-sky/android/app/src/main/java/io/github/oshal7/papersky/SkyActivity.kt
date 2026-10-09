package io.github.oshal7.papersky

import android.app.Activity
import android.app.WallpaperManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast

/** Full-screen, interactive sky (60 fps) — the app you open. Also the wallpaper's settings screen. */
class SkyView(context: Context, private val prefs: Prefs) : View(context) {
    private val sky = Sky(resources.displayMetrics.density)
    private var lastNs = 0L
    private var running = false

    init { prefs.applyTo(sky) }

    fun refresh() = prefs.applyTo(sky)

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) = sky.resize(w, h)

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> sky.touch(event.x, event.y, true)
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> { sky.release(); performClick() }
        }
        return true
    }

    override fun performClick(): Boolean = super.performClick()

    fun start() { running = true; lastNs = System.nanoTime(); invalidate() }
    fun stop() { running = false }

    override fun onDraw(canvas: Canvas) {
        val now = System.nanoTime()
        sky.step(((now - lastNs) / 1e9f).coerceIn(0f, 0.05f))
        lastNs = now
        sky.draw(canvas)
        if (running) {
            if (prefs.lowPower) postInvalidateDelayed(33) else postInvalidateOnAnimation()
        }
    }
}

class SkyActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var skyView: SkyView
    private lateinit var controls: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        skyView = SkyView(this, prefs)

        val root = FrameLayout(this)
        root.addView(skyView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        controls = buildControls()
        root.addView(controls, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM).apply {
            val m = dp(16); setMargins(m, m, m, m + dp(24))
        })
        val toggle = pill("⋯").apply {
            setOnClickListener { controls.visibility = if (controls.visibility == View.VISIBLE) View.GONE else View.VISIBLE }
        }
        root.addView(toggle, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.END).apply {
            val m = dp(16); setMargins(m, m + dp(32), m, m)
        })
        setContentView(root)
        immersive()
    }

    override fun onResume() { super.onResume(); skyView.refresh(); skyView.start() }
    override fun onPause() { skyView.stop(); super.onPause() }

    private fun immersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
        }
    }

    // ---------- controls (built in code: no layout files, no libraries) ----------
    private fun buildControls(): LinearLayout {
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(Color.argb(150, 10, 12, 24)) }
        }

        // mood
        val moods = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        listOf("dusk" to "Dusk", "day" to "Morning", "night" to "Night").forEach { (key, label) ->
            moods.addView(pill(label).apply {
                setOnClickListener { prefs.mood = key; skyView.refresh() }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { setMargins(dp(3), 0, dp(3), 0) })
        }
        panel.addView(moods)

        // planes
        val planesLabel = label("Planes: ${prefs.planes}")
        panel.addView(planesLabel, margins(top = 12))
        panel.addView(SeekBar(this).apply {
            max = 34
            progress = prefs.planes - 6
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar?, v: Int, fromUser: Boolean) { planesLabel.text = "Planes: ${v + 6}" }
                override fun onStartTrackingTouch(s: SeekBar?) {}
                override fun onStopTrackingTouch(s: SeekBar?) { prefs.planes = progress + 6; skyView.refresh() }
            })
        })

        // switches
        panel.addView(switch("Soft trails", prefs.trails) { prefs.trails = it; skyView.refresh() }, margins(top = 6))
        panel.addView(switch("Follow my finger", prefs.follow) { prefs.follow = it; skyView.refresh() })
        panel.addView(switch("Low power (20 fps)", prefs.lowPower) { prefs.lowPower = it })

        // set as wallpaper
        panel.addView(Button(this).apply {
            text = "Set as wallpaper"
            isAllCaps = false
            setTextColor(Color.rgb(20, 22, 36))
            background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(Color.rgb(246, 239, 232)) }
            setOnClickListener { setAsWallpaper() }
        }, margins(top = 12))
        panel.addView(label("Pick “Home and lock screens”. Your PIN stays with Android.").apply { alpha = 0.7f; textSize = 12f }, margins(top = 8))
        return panel
    }

    private fun setAsWallpaper() {
        val direct = Intent(WallpaperManager.ACTION_CHANGE_LIVE_WALLPAPER)
            .putExtra(WallpaperManager.EXTRA_LIVE_WALLPAPER_COMPONENT, ComponentName(this, PaperSkyWallpaperService::class.java))
        try {
            startActivity(direct)
        } catch (_: Exception) {
            try {
                startActivity(Intent(WallpaperManager.ACTION_LIVE_WALLPAPER_CHOOSER))
                Toast.makeText(this, "Choose “Paper Sky” in the list", Toast.LENGTH_LONG).show()
            } catch (_: Exception) {
                Toast.makeText(this, "Open Settings › Wallpaper › Live wallpapers › Paper Sky", Toast.LENGTH_LONG).show()
            }
        }
    }

    // ---------- tiny view helpers ----------
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun margins(top: Int = 0) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }
    private fun label(text: String) = TextView(this).apply { this.text = text; setTextColor(Color.rgb(246, 239, 232)); textSize = 14f }
    private fun pill(text: String) = Button(this).apply {
        this.text = text
        isAllCaps = false
        setTextColor(Color.rgb(246, 239, 232))
        background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(Color.argb(90, 255, 255, 255)) }
        minHeight = dp(40); minimumHeight = dp(40)
        setPadding(dp(14), 0, dp(14), 0)
    }
    @Suppress("DEPRECATION")
    private fun switch(text: String, on: Boolean, onChange: (Boolean) -> Unit) = Switch(this).apply {
        this.text = text
        isChecked = on
        setTextColor(Color.rgb(246, 239, 232))
        setOnCheckedChangeListener { _, checked -> onChange(checked) }
    }
}
