package io.github.oshal7.papersky

import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

// ---------------------------------------------------------------
// Paper Sky renderer + simulation (a port of apps/paper-sky/web/sky.js).
//
// Planes live in a bubble of 3D space and drift on a slow sine flow
// field in loose flocks. A finger moves the AIR: its velocity is written
// into a coarse screen grid that fades over a couple of seconds, and
// planes caught in it copy that motion. Holding still makes nearby
// planes circle the fingertip.
//
// Pure android.graphics: four triangles per plane, perspective divide,
// painter's algorithm. No allocation per frame.
// ---------------------------------------------------------------

class Mood(
    val key: String,
    val stops: IntArray, val at: FloatArray,
    val paper: FloatArray, val fog: FloatArray,
    val line: Int, val trail: Int, val dot: Int,
    light: FloatArray,
) {
    val light: FloatArray = norm(light)

    companion object {
        private fun rgb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
        val ALL = listOf(
            Mood("dusk", intArrayOf(0xFF232A45.toInt(), 0xFF4B4A6B.toInt(), 0xFFB48A8F.toInt(), 0xFFE7B99C.toInt()), floatArrayOf(0f, 0.45f, 0.8f, 1f),
                floatArrayOf(255f, 244f, 236f), floatArrayOf(118f, 104f, 134f), rgb(40, 30, 50), rgb(255, 236, 226), rgb(255, 240, 230), floatArrayOf(0.5f, 0.35f, -0.6f)),
            Mood("day", intArrayOf(0xFFA9C3DC.toInt(), 0xFFD5E1EA.toInt(), 0xFFF4ECE0.toInt()), floatArrayOf(0f, 0.55f, 1f),
                floatArrayOf(252f, 251f, 247f), floatArrayOf(214f, 224f, 232f), rgb(35, 45, 60), rgb(40, 55, 75), rgb(70, 80, 95), floatArrayOf(-0.3f, 0.85f, -0.45f)),
            Mood("night", intArrayOf(0xFF03050B.toInt(), 0xFF0A1020.toInt(), 0xFF141A2C.toInt()), floatArrayOf(0f, 0.6f, 1f),
                floatArrayOf(222f, 228f, 245f), floatArrayOf(16f, 22f, 40f), rgb(0, 0, 0), rgb(200, 215, 255), rgb(220, 230, 255), floatArrayOf(0.2f, 0.9f, -0.3f)),
        )
        fun of(key: String?) = ALL.firstOrNull { it.key == key } ?: ALL[0]
    }
}

private fun norm(v: FloatArray): FloatArray {
    val l = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).takeIf { it > 0f } ?: 1f
    return floatArrayOf(v[0] / l, v[1] / l, v[2] / l)
}
private fun wrapAngle(a: Float) = atan2(sin(a), cos(a))
private fun clampf(v: Float, a: Float, b: Float) = min(b, max(a, v))
private fun rnd(a: Float, b: Float) = a + Random.nextFloat() * (b - a)

private const val TRAIL = 24

private class Plane {
    var x = 0f; var y = 0f; var z = 0f
    var vx = 0f; var vy = 0f; var vz = 0f
    var yaw = 0f; var pitch = 0f; var roll = 0f; var turn = 0f
    var prevYaw = Float.NaN
    var rate = 1f; var ph = 0f; var follow = 0f; var alpha = 0f
    val trail = FloatArray(TRAIL * 3); var trailN = 0; var trailStart = 0; var trailT = 0f
    fun pushTrail(px: Float, py: Float, pz: Float) {
        val idx = if (trailN < TRAIL) { trailN++; (trailStart + trailN - 1) % TRAIL } else { val i = trailStart; trailStart = (trailStart + 1) % TRAIL; i }
        trail[idx * 3] = px; trail[idx * 3 + 1] = py; trail[idx * 3 + 2] = pz
    }
    fun trailAt(k: Int, out: FloatArray) { val i = (trailStart + k) % TRAIL; out[0] = trail[i * 3]; out[1] = trail[i * 3 + 1]; out[2] = trail[i * 3 + 2] }
}

private class Tri {
    val sx = FloatArray(3); val sy = FloatArray(3)
    var depth = 0f; var light = 0f; var fog = 0f; var alpha = 1f
}

class Sky(private val density: Float) {
    // ---- settings ----
    var mood: Mood = Mood.ALL[0]
        set(value) { field = value; shaderDirty = true }
    var planeCount = 26
    var trails = true
    var autopilot = false
    var follow = true
    var pace = 1f
    /** Home-screen page offset, -0.5 (first page) … 0.5 (last page): a gentle parallax. */
    var parallax = 0f

    // ---- view ----
    private var W = 1f; private var H = 1f; private var focal = 1f
    private var cz = 11f; private var rx = 6f; private var ry = 4f; private val rz = 8f
    private val near = 0.8f
    private var camX = 0f

    // ---- pointer + air grid ----
    private var px = 0f; private var py = 0f; private var ppx = 0f; private var ppy = 0f
    private var pvx = 0f; private var pvy = 0f
    private var down = false; private var inside = false
    private var holdTime = 0f
    private val reach get() = 170f * density * 1.1f
    private var cols = 36; private var rows = 64; private var cw = 1f; private var ch = 1f
    private var gvx = FloatArray(cols * rows); private var gvy = FloatArray(cols * rows)

    // ---- state ----
    private val planes = ArrayList<Plane>()
    private var t = 0f
    private val motes = Array(80) { floatArrayOf(Random.nextFloat(), Random.nextFloat(), rnd(0.2f, 1f), rnd(0f, 6.3f)) }
    private var ghostOn = false; private var ghostT0 = 0f; private var ghostDur = 0f; private var ghostCx = 0f; private var ghostCy = 0f
    private var ghostR = 0f; private var ghostDir = 1f; private var ghostNext = 3f

    // ---- drawing (reused every frame) ----
    private val bgPaint = Paint()
    private var shaderDirty = true
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val dotPaint = Paint()
    private val path = Path()
    private var tris = Array(0) { Tri() }
    private var triN = 0
    private val byDepth = Comparator<Tri> { a, b -> b.depth.compareTo(a.depth) }
    private val tmp = FloatArray(3); private val tmp2 = FloatArray(3)
    private val w0 = FloatArray(3); private val w1 = FloatArray(3); private val w2 = FloatArray(3)

    // plane space: x forward, y up, z right; wing tips tilt up (dihedral)
    private val shape = arrayOf(
        floatArrayOf(1f, 0f, 0f), floatArrayOf(-0.7f, 0.08f, -0.62f), floatArrayOf(-0.7f, 0f, -0.04f),
        floatArrayOf(1f, 0f, 0f), floatArrayOf(-0.7f, 0f, 0.04f), floatArrayOf(-0.7f, 0.08f, 0.62f),
        floatArrayOf(1f, 0f, 0f), floatArrayOf(-0.7f, 0f, -0.04f), floatArrayOf(-0.7f, -0.22f, 0f),
        floatArrayOf(1f, 0f, 0f), floatArrayOf(-0.7f, -0.22f, 0f), floatArrayOf(-0.7f, 0f, 0.04f),
    )
    private val tone = floatArrayOf(1f, 1f, 0.86f, 0.86f)
    private val size = 0.5f

    fun resize(width: Int, height: Int) {
        W = max(1, width).toFloat(); H = max(1, height).toFloat()
        focal = H * 1.05f
        rx = (W / 2f / focal) * cz * 1.25f
        ry = (H / 2f / focal) * cz * 1.1f
        cols = 36
        rows = max(8, (36f * H / W).roundToInt())
        cw = W / cols; ch = H / rows
        gvx = FloatArray(cols * rows); gvy = FloatArray(cols * rows)
        shaderDirty = true
        stroke.strokeWidth = 0.7f * density
        line.strokeWidth = 1f * density
    }

    // ---------- input ----------
    fun touch(x: Float, y: Float, isDown: Boolean) {
        if (!inside) { ppx = x; ppy = y }
        px = x; py = y; down = isDown; inside = true
    }
    fun release() { down = false; inside = false }

    // ---------- simulation ----------
    private fun targetCount() = max(4, (planeCount * clampf(W / H / 1.6f, 0.6f, 1f)).roundToInt())

    private fun makePlane(): Plane = Plane().apply {
        x = rnd(-1f, 1f) * rx * 0.8f; y = rnd(-1f, 1f) * ry * 0.8f; z = cz + rnd(-1f, 1f) * rz * 0.8f
        val d = norm(floatArrayOf(rnd(-1f, 1f), rnd(-0.3f, 0.3f), rnd(-1f, 1f)))
        vx = d[0]; vy = d[1]; vz = d[2]; yaw = atan2(vz, vx)
        rate = rnd(0.75f, 1.25f); ph = rnd(0f, 6.3f)
    }

    fun step(dtIn: Float) {
        val dt = min(0.05f, max(0f, dtIn))
        t += dt
        val n = targetCount()
        while (planes.size < n) planes.add(makePlane())
        while (planes.size > n) planes.removeAt(planes.size - 1)

        if (autopilot) ghost()
        if (dt > 0f) {
            pvx += ((px - ppx) / dt - pvx) * 0.5f
            pvy += ((py - ppy) / dt - pvy) * 0.5f
        }
        ppx = px; ppy = py
        holdTime = if (down && hypot(pvx, pvy) < 60f * density) holdTime + dt else 0f
        camX += (parallax * rx * 0.35f - camX) * (1f - exp(-6f * dt))

        if (follow) writeAir(dt)
        val f = exp(-dt / 2.2f)
        for (i in gvx.indices) { gvx[i] *= f; gvy[i] *= f }
        for (i in planes.indices) fly(planes[i], i, dt)
    }

    // On the lock screen nobody can touch the wallpaper: an invisible hand draws slow loops instead.
    private fun ghost() {
        if (!ghostOn && t > ghostNext) {
            ghostOn = true; ghostT0 = t; ghostDur = rnd(5f, 9f)
            ghostCx = rnd(0.3f, 0.7f) * W; ghostCy = rnd(0.4f, 0.7f) * H
            ghostR = rnd(0.15f, 0.28f) * min(W, H); ghostDir = if (Random.nextBoolean()) 1f else -1f
        }
        if (ghostOn) {
            val k = (t - ghostT0) / ghostDur
            if (k >= 1f) { ghostOn = false; ghostNext = t + rnd(6f, 14f); release(); return }
            val a = k * 2f * PI.toFloat() * ghostDir
            touch(ghostCx + cos(a) * ghostR, ghostCy + sin(a) * ghostR * 0.6f, true)
        }
    }

    private fun writeAir(dt: Float) {
        if (!inside) return
        var vx = pvx; var vy = pvy
        val sp = hypot(vx, vy)
        if (sp < 30f * density) return
        val cap = 1500f * density
        if (sp > cap) { vx *= cap / sp; vy *= cap / sp }
        val r = reach
        val strength = if (down) 1f else 0.7f
        val c0 = max(0, floor((px - r) / cw).toInt()); val c1 = min(cols - 1, ceil((px + r) / cw).toInt())
        val r0 = max(0, floor((py - r) / ch).toInt()); val r1 = min(rows - 1, ceil((py + r) / ch).toInt())
        for (row in r0..r1) for (col in c0..c1) {
            val d = hypot((col + 0.5f) * cw - px, (row + 0.5f) * ch - py)
            if (d > r) continue
            val i = row * cols + col
            val k = min(1f, (1f - d / r).pow(2) * strength * dt * 16f)
            gvx[i] += (vx - gvx[i]) * k
            gvy[i] += (vy - gvy[i]) * k
        }
    }

    private fun sampleAir(sx: Float, sy: Float, out: FloatArray) {
        val gx = sx / cw - 0.5f; val gy = sy / ch - 0.5f
        val c0 = floor(gx).toInt(); val r0 = floor(gy).toInt()
        val fx = gx - c0; val fy = gy - r0
        var vx = 0f; var vy = 0f
        fun add(c: Int, r: Int, w: Float) {
            if (c < 0 || r < 0 || c >= cols || r >= rows) return
            vx += gvx[r * cols + c] * w; vy += gvy[r * cols + c] * w
        }
        add(c0, r0, (1 - fx) * (1 - fy)); add(c0 + 1, r0, fx * (1 - fy)); add(c0, r0 + 1, (1 - fx) * fy); add(c0 + 1, r0 + 1, fx * fy)
        out[0] = vx; out[1] = vy
    }

    private fun projectX(x: Float, z: Float) = W / 2f + ((x - camX) / z) * focal
    private fun projectY(y: Float, z: Float) = H / 2f - (y / z) * focal

    private fun fly(p: Plane, i: Int, dt: Float) {
        val c = 1.1f * pace * p.rate
        // flow field + own heading
        val sp = sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz).takeIf { it > 0f } ?: 1f
        var dx = p.vx / sp * 1.2f + (sin(p.y * 0.35f + t * 0.07f) + sin(p.z * 0.21f - t * 0.05f)) * 0.6f
        var dy = p.vy / sp * 1.2f + (sin(p.z * 0.28f + t * 0.06f) * 0.5f + sin(p.x * 0.19f + t * 0.04f) * 0.4f) * 0.6f
        var dz = p.vz / sp * 1.2f + (sin(p.x * 0.31f - t * 0.06f) + sin(p.y * 0.23f + t * 0.08f)) * 0.6f
        // loose flocking
        var nb = 0; var ax = 0f; var ay = 0f; var az = 0f; var cx = 0f; var cy = 0f; var czs = 0f; var sx = 0f; var sy = 0f; var sz = 0f
        for (j in planes.indices) {
            if (j == i) continue
            val q = planes[j]
            val ex = p.x - q.x; val ey = p.y - q.y; val ez = p.z - q.z
            val d2 = ex * ex + ey * ey + ez * ez
            if (d2 > 12f) continue
            nb++; ax += q.vx; ay += q.vy; az += q.vz; cx += q.x; cy += q.y; czs += q.z
            if (d2 < 1.4f) { sx += ex / (d2 + 0.05f); sy += ey / (d2 + 0.05f); sz += ez / (d2 + 0.05f) }
        }
        if (nb > 0) {
            val al = norm(floatArrayOf(ax, ay, az))
            dx += al[0] * 0.64f + (cx / nb - p.x) * 0.096f
            dy += al[1] * 0.64f + (cy / nb - p.y) * 0.096f
            dz += al[2] * 0.64f + (czs / nb - p.z) * 0.096f
        }
        dx += sx * 0.5f; dy += sy * 0.5f; dz += sz * 0.5f
        // soft bubble: turn back the further out they drift
        val ox = p.x / rx; val oy = p.y / ry; val oz = (p.z - cz) / rz
        val r = sqrt(ox * ox + oy * oy + oz * oz)
        if (r > 0.7f) { val push = (r - 0.7f) * 5f; dx -= ox / r * push; dy -= oy / r * push * 1.3f; dz -= oz / r * push }
        if (p.z < 2.5f) dz += (2.5f - p.z) * 3f
        val nn = norm(floatArrayOf(dx, dy, dz))
        val glide = 1f - 0.3f * nn[1]
        var wx = nn[0] * c * glide; var wy = nn[1] * c * glide; var wz = nn[2] * c * glide

        // copy the air the finger moved (screen px/s → world units/s at this depth)
        val ssx = projectX(p.x, p.z); val ssy = projectY(p.y, p.z)
        var w = 0f
        if (p.z > near) {
            sampleAir(ssx, ssy, tmp)
            var fx = tmp[0] * p.z / focal; var fy = -tmp[1] * p.z / focal
            val m = hypot(fx, fy); val cap = c * 4f
            if (m > cap) { fx *= cap / m; fy *= cap / m }
            w = clampf(m / (c * 0.6f), 0f, 1f)
            wx += (fx - wx) * w; wy += (fy - wy) * w; wz *= 1f - 0.7f * w
        }
        // holding still: circle the fingertip
        if (down && holdTime > 0.25f && p.z > near) {
            val ds = hypot(ssx - px, ssy - py); val rr = reach * 1.8f
            if (ds < rr) {
                val fxw = (px - W / 2f) / focal * p.z + camX; val fyw = -(py - H / 2f) / focal * p.z
                val ex = fxw - p.x; val ey = fyw - p.y; val d = hypot(ex, ey).takeIf { it > 0.001f } ?: 0.001f
                val ring = reach * 0.55f * p.z / focal
                val radial = clampf((d - ring) / ring, -1f, 1f)
                val wo = (1f - ds / rr) * min(1f, holdTime)
                wx += ((-ey / d) * c * 1.3f + (ex / d) * radial * c - wx) * wo
                wy += ((ex / d) * c * 1.3f + (ey / d) * radial * c - wy) * wo
                wz *= 1f - 0.8f * wo
                w = max(w, wo)
            }
        }
        val k = 1f - exp(-(0.9f + 5f * w) * dt)
        p.vx += (wx - p.vx) * k; p.vy += (wy - p.vy) * k; p.vz += (wz - p.vz) * k
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
        p.follow += (w - p.follow) * (1f - exp(-6f * dt))

        // body follows velocity; bank into turns
        val hor = hypot(p.vx, p.vz)
        val yawT = if (hor > 0.02f) atan2(p.vz, p.vx) else p.yaw
        val pitchT = atan2(p.vy, max(hor, 0.001f)) * 0.85f
        if (!p.prevYaw.isNaN() && dt > 0f) p.turn += (wrapAngle(yawT - p.prevYaw) / dt - p.turn) * (1f - exp(-4f * dt))
        p.prevYaw = yawT
        val rollT = clampf(p.turn * 0.9f, -1f, 1f) + 0.06f * sin(t * 0.9f + p.ph)
        val e = 1f - exp(-4f * dt)
        p.yaw += wrapAngle(yawT - p.yaw) * e; p.pitch += wrapAngle(pitchT - p.pitch) * e; p.roll += wrapAngle(rollT - p.roll) * e
        p.alpha = min(1f, p.alpha + dt * 0.5f)
        if (trails) {
            p.trailT -= dt
            if (p.trailT <= 0f) { p.trailT = 0.07f; p.pushTrail(p.x, p.y, p.z) }
        } else p.trailN = 0
    }

    private fun toWorld(p: Plane, c: FloatArray, out: FloatArray) {
        val cr = cos(p.roll); val sr = sin(p.roll); val cp = cos(p.pitch); val sp = sin(p.pitch); val cyw = cos(p.yaw); val syw = sin(p.yaw)
        val y1 = c[1] * cr - c[2] * sr; val z1 = c[1] * sr + c[2] * cr
        val x2 = c[0] * cp - y1 * sp; val y2 = c[0] * sp + y1 * cp
        val x3 = x2 * cyw - z1 * syw; val z3 = x2 * syw + z1 * cyw
        out[0] = p.x + x3 * size; out[1] = p.y + y2 * size; out[2] = p.z + z3 * size
    }

    // ---------- drawing ----------
    fun draw(canvas: Canvas) {
        val m = mood
        if (shaderDirty) {
            bgPaint.shader = LinearGradient(0f, 0f, 0f, H, m.stops, m.at, Shader.TileMode.CLAMP)
            shaderDirty = false
        }
        canvas.drawRect(0f, 0f, W, H, bgPaint)

        // motes / stars
        val night = m.key == "night"
        for (mo in motes) {
            val tw = if (night) 0.5f + 0.5f * sin(t * (0.5f + mo[2]) + mo[3]) else 1f
            dotPaint.color = withAlpha(m.dot, (0.12f + 0.3f * mo[2]) * tw)
            val r = (if (night) 0.6f + mo[2] else 0.8f + mo[2] * 1.2f) * density
            val x = (((mo[0] + t * 0.002f * mo[2]) % 1f) * W) - camX / rx * W * 0.04f * mo[2]
            val y = mo[1] * H + sin(t * 0.2f + mo[3]) * 8f * density
            canvas.drawRect(x, y, x + r, y + r, dotPaint)
        }

        // trails
        if (trails) {
            for (p in planes) {
                for (k in 1 until p.trailN) {
                    p.trailAt(k - 1, tmp); p.trailAt(k, tmp2)
                    if (tmp[2] < near || tmp2[2] < near) continue
                    val a = (k.toFloat() / p.trailN) * 0.22f * p.alpha * (1f - clampf((tmp2[2] - 6f) / 16f, 0f, 0.85f))
                    line.color = withAlpha(m.trail, a)
                    canvas.drawLine(projectX(tmp[0], tmp[2]), projectY(tmp[1], tmp[2]), projectX(tmp2[0], tmp2[2]), projectY(tmp2[1], tmp2[2]), line)
                }
            }
        }

        // gather triangles, sort far → near (painter's algorithm)
        if (tris.size < planes.size * 4) tris = Array(planes.size * 4) { Tri() }
        triN = 0
        for (p in planes) {
            for (f in 0 until 4) {
                toWorld(p, shape[f * 3], w0); toWorld(p, shape[f * 3 + 1], w1); toWorld(p, shape[f * 3 + 2], w2)
                if (w0[2] < near || w1[2] < near || w2[2] < near) continue
                val tr = tris[triN++]
                tr.sx[0] = projectX(w0[0], w0[2]); tr.sy[0] = projectY(w0[1], w0[2])
                tr.sx[1] = projectX(w1[0], w1[2]); tr.sy[1] = projectY(w1[1], w1[2])
                tr.sx[2] = projectX(w2[0], w2[2]); tr.sy[2] = projectY(w2[1], w2[2])
                // normal · light (paper is lit on both sides → abs)
                val ux = w1[0] - w0[0]; val uy = w1[1] - w0[1]; val uz = w1[2] - w0[2]
                val vx = w2[0] - w0[0]; val vy = w2[1] - w0[1]; val vz = w2[2] - w0[2]
                var nx = uy * vz - uz * vy; var ny = uz * vx - ux * vz; var nz = ux * vy - uy * vx
                val nl = sqrt(nx * nx + ny * ny + nz * nz).takeIf { it > 0f } ?: 1f
                nx /= nl; ny /= nl; nz /= nl
                tr.light = (0.58f + 0.42f * abs(nx * m.light[0] + ny * m.light[1] + nz * m.light[2])) * tone[f]
                tr.depth = (w0[2] + w1[2] + w2[2]) / 3f
                tr.fog = clampf((tr.depth - 6f) / 16f, 0f, 1f) * 0.85f
                tr.alpha = p.alpha
            }
        }
        java.util.Arrays.sort(tris, 0, triN, byDepth)
        for (i in 0 until triN) {
            val tr = tris[i]
            val r = min(255f, m.paper[0] * tr.light); val g = min(255f, m.paper[1] * tr.light); val b = min(255f, m.paper[2] * tr.light)
            val rr = (r + (m.fog[0] - r) * tr.fog).toInt(); val gg = (g + (m.fog[1] - g) * tr.fog).toInt(); val bb = (b + (m.fog[2] - b) * tr.fog).toInt()
            fill.color = ((tr.alpha * 255).toInt() shl 24) or (rr shl 16) or (gg shl 8) or bb
            stroke.color = withAlpha(m.line, 0.35f * (1f - tr.fog) * tr.alpha)
            path.rewind()
            path.moveTo(tr.sx[0], tr.sy[0]); path.lineTo(tr.sx[1], tr.sy[1]); path.lineTo(tr.sx[2], tr.sy[2]); path.close()
            canvas.drawPath(path, fill)
            canvas.drawPath(path, stroke)
        }
    }

    private fun withAlpha(color: Int, a: Float) = ((clampf(a, 0f, 1f) * 255).toInt() shl 24) or (color and 0xFFFFFF)
}
