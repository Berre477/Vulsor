// ── Cosmos starfield engine — C++ compiled to WebAssembly ───────────────
// All animation logic lives here: star generation, parallax drift,
// per-star twinkle, shooting stars, and software rasterization into an
// RGBA framebuffer. The JS side (js/starfield.js) only instantiates the
// module and blits the framebuffer onto a <canvas> each frame.
//
// Rebuild with:  npm run build-wasm   (requires emscripten / em++)

#include <emscripten.h>
#include <math.h>
#include <stdint.h>
#include <string.h>

static const int MAX_W = 2560;
static const int MAX_H = 1600;

static uint8_t fb[MAX_W * MAX_H * 4];
static int W = 0, H = 0;

// ── Tiny deterministic RNG (xorshift32) ─────────────────────────────────
static uint32_t rngState = 0x9e3779b9u;
static inline uint32_t rngU32() {
    uint32_t x = rngState;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    return rngState = x;
}
static inline float rngF() { return (rngU32() >> 8) * (1.0f / 16777216.0f); }  // [0,1)
static inline float rngRange(float a, float b) { return a + (b - a) * rngF(); }

// ── Stars ────────────────────────────────────────────────────────────────
struct Star {
    float x, y;            // normalized position [0,1)
    float size;            // glow radius in px
    float base, twAmp;     // base brightness + twinkle amplitude
    float twSpeed, phase;  // twinkle rate (rad/s) + phase offset
    float drift;           // horizontal drift in px/s (parallax)
    float r, g, b;         // color [0,1]
};
static const int NSTARS = 420;
static Star stars[NSTARS];

// Palette matching the old CSS starfield: white, slate, indigo tints
static const float PALETTE[4][3] = {
    { 1.00f, 1.00f, 1.00f },   // #ffffff
    { 0.80f, 0.84f, 0.88f },   // #cbd5e1
    { 0.88f, 0.91f, 1.00f },   // #e0e7ff
    { 0.78f, 0.82f, 0.99f },   // #c7d2fe
};

// ── Shooting stars ───────────────────────────────────────────────────────
struct Meteor {
    float x0, y0;          // spawn point (px)
    float vx, vy;          // px/s
    double born;           // spawn time (s)
    float life;            // duration (s)
    bool active;
};
static Meteor meteors[2];
static double nextMeteorAt = 0.0;

// ── Rasterization ────────────────────────────────────────────────────────
static inline void plot(int x, int y, float r, float g, float b, float a) {
    if ((unsigned)x >= (unsigned)W || (unsigned)y >= (unsigned)H) return;
    uint8_t* p = &fb[((size_t)y * W + x) * 4];
    uint8_t a8 = (uint8_t)(a * 255.0f + 0.5f);
    if (a8 <= p[3]) return;  // keep the brighter contribution
    p[0] = (uint8_t)(r * 255.0f + 0.5f);
    p[1] = (uint8_t)(g * 255.0f + 0.5f);
    p[2] = (uint8_t)(b * 255.0f + 0.5f);
    p[3] = a8;
}

// Soft gaussian-ish glow blob
static void blob(float cx, float cy, float radius, float r, float g, float b, float intensity) {
    if (intensity <= 0.003f) return;
    int x0 = (int)floorf(cx - radius), x1 = (int)ceilf(cx + radius);
    int y0 = (int)floorf(cy - radius), y1 = (int)ceilf(cy + radius);
    float invR2 = 1.0f / (radius * radius);
    for (int y = y0; y <= y1; y++) {
        for (int x = x0; x <= x1; x++) {
            float dx = x + 0.5f - cx, dy = y + 0.5f - cy;
            float d2 = (dx * dx + dy * dy) * invR2;
            if (d2 >= 1.0f) continue;
            plot(x, y, r, g, b, intensity * expf(-4.0f * d2));
        }
    }
}

static void spawnMeteor(double t) {
    for (int i = 0; i < 2; i++) {
        if (meteors[i].active) continue;
        Meteor& m = meteors[i];
        m.x0 = rngRange(0.15f, 0.95f) * W;
        m.y0 = rngRange(0.05f, 0.45f) * H;
        float speed = rngRange(380.0f, 620.0f);
        float angle = rngRange(2.45f, 2.85f);  // ~140-163°: leftward and downward
        m.vx = cosf(angle) * speed;
        m.vy = sinf(angle) * speed;
        m.born = t;
        m.life = rngRange(0.9f, 1.4f);
        m.active = true;
        return;
    }
}

static void drawMeteor(Meteor& m, double t) {
    float age = (float)(t - m.born);
    if (age >= m.life) { m.active = false; return; }
    // Fade in fast, fade out toward the end of life
    float fade = age < 0.15f ? age / 0.15f : 1.0f - (age - 0.15f) / (m.life - 0.15f);
    float hx = m.x0 + m.vx * age;
    float hy = m.y0 + m.vy * age;
    const int TRAIL = 56;
    const float dt = 0.0035f;  // spacing between trail samples (s)
    for (int i = 0; i < TRAIL; i++) {
        float k = 1.0f - (float)i / TRAIL;     // 1 at head → 0 at tail
        float px = hx - m.vx * dt * i;
        float py = hy - m.vy * dt * i;
        float a = fade * k * k * 0.85f;
        float radius = 1.0f + 1.6f * k;
        blob(px, py, radius, 1.0f, 1.0f, 0.92f + 0.08f * k, a);
    }
}

// ── Exports ──────────────────────────────────────────────────────────────
extern "C" {

EMSCRIPTEN_KEEPALIVE
void init(int w, int h, uint32_t seed) {
    W = w < 1 ? 1 : (w > MAX_W ? MAX_W : w);
    H = h < 1 ? 1 : (h > MAX_H ? MAX_H : h);
    rngState = seed ? seed : 0x9e3779b9u;

    for (int i = 0; i < NSTARS; i++) {
        Star& s = stars[i];
        s.x = rngF();
        s.y = rngF();
        // Three parallax layers: distant/dim (60%), mid (30%), near/bright (10%)
        float u = rngF();
        if (u < 0.60f)      { s.size = rngRange(0.7f, 1.1f);  s.base = rngRange(0.18f, 0.40f); s.drift = rngRange(0.8f, 1.6f); }
        else if (u < 0.90f) { s.size = rngRange(1.1f, 1.8f);  s.base = rngRange(0.35f, 0.60f); s.drift = rngRange(1.6f, 3.0f); }
        else                { s.size = rngRange(1.8f, 2.8f);  s.base = rngRange(0.55f, 0.80f); s.drift = rngRange(3.0f, 5.0f); }
        s.twAmp   = s.base * rngRange(0.35f, 0.75f);
        s.twSpeed = rngRange(0.4f, 2.2f);
        s.phase   = rngRange(0.0f, 6.2831853f);
        const float* c = PALETTE[rngU32() & 3];
        s.r = c[0]; s.g = c[1]; s.b = c[2];
    }
    for (int i = 0; i < 2; i++) meteors[i].active = false;
    nextMeteorAt = 0.0;
}

EMSCRIPTEN_KEEPALIVE
void render(double tMs) {
    if (!W) return;
    double t = tMs * 0.001;
    memset(fb, 0, (size_t)W * H * 4);

    for (int i = 0; i < NSTARS; i++) {
        Star& s = stars[i];
        float tw = s.base + s.twAmp * sinf((float)(t * s.twSpeed) + s.phase);
        if (tw <= 0.0f) continue;
        if (tw > 1.0f) tw = 1.0f;
        float x = fmodf(s.x * W + s.drift * (float)t, (float)W);
        if (x < 0) x += W;
        blob(x, s.y * H, s.size, s.r, s.g, s.b, tw);
    }

    if (t >= nextMeteorAt) {
        spawnMeteor(t);
        nextMeteorAt = t + rngRange(6.0f, 14.0f);
    }
    for (int i = 0; i < 2; i++)
        if (meteors[i].active) drawMeteor(meteors[i], t);
}

EMSCRIPTEN_KEEPALIVE
uint8_t* framebuffer() { return fb; }

}  // extern "C"
