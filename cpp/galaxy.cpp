// ── Galaxy engine — C++ compiled to WebAssembly ─────────────────────────
// Number-crunching core of the 3D Milky Way / Solar System view:
//   • gal_build()   — generates the spiral-arm / field / bulge star point
//                     cloud (positions + colors) and the dust lanes
//   • comet_step()  — per-frame Kepler-ish comet motion + tail particles
// js/galaxy.js wraps the buffers in THREE.BufferAttribute views directly
// over wasm memory, so three.js renders them with zero copies.
//
// Rebuild with:  npm run build-wasm   (requires emscripten / em++)

#include <emscripten.h>
#include <math.h>
#include <stdint.h>

static const float TWO_PI = 6.2831853f;

// Must match the constants in js/galaxy.js
static const int   ARMS    = 4;
static const float GAL_R   = 120.0f;
static const float BULGE_R = 22.0f;
static const float WIND    = 3.4f;

static const int MAX_STARS = 120000;
static const int MAX_DUST  = 9000;

static float starPos[MAX_STARS * 3];
static float starCol[MAX_STARS * 3];
static float dustPos[MAX_DUST * 3];
static int   dustCount = 0;

// ── Tiny deterministic RNG (xorshift32) ─────────────────────────────────
static uint32_t rngState = 0x12345678u;
static inline uint32_t rngU32() {
    uint32_t x = rngState;
    x ^= x << 13; x ^= x >> 17; x ^= x << 5;
    return rngState = x;
}
static inline float rngF() { return (rngU32() >> 8) * (1.0f / 16777216.0f); }  // [0,1)
static inline float rngRange(float a, float b) { return a + (b - a) * rngF(); }

// HSL → RGB, same formula as THREE.Color.setHSL
static inline float hue2rgb(float p, float q, float t) {
    if (t < 0.0f) t += 1.0f;
    if (t > 1.0f) t -= 1.0f;
    if (t < 1.0f / 6.0f) return p + (q - p) * 6.0f * t;
    if (t < 1.0f / 2.0f) return q;
    if (t < 2.0f / 3.0f) return p + (q - p) * 6.0f * (2.0f / 3.0f - t);
    return p;
}
static void setHSL(float* out, float h, float s, float l) {
    h = h - floorf(h);
    if (s == 0.0f) { out[0] = out[1] = out[2] = l; return; }
    float q = l <= 0.5f ? l * (1.0f + s) : l + s - l * s;
    float p = 2.0f * l - q;
    out[0] = hue2rgb(p, q, h + 1.0f / 3.0f);
    out[1] = hue2rgb(p, q, h);
    out[2] = hue2rgb(p, q, h - 1.0f / 3.0f);
}

// Point on a logarithmic-ish spiral arm (mirrors _armPoint in js/galaxy.js)
static void armPoint(int arm, float t, float spreadMul, float* rOut, float* aOut) {
    float r = BULGE_R * 0.5f + t * (GAL_R - BULGE_R * 0.5f);
    float spread = (0.55f - 0.4f * t) * (rngF() - 0.5f) * spreadMul;
    *rOut = r;
    *aOut = arm * (TWO_PI / ARMS) + WIND * (r / GAL_R) + spread;
}

// ── Comet (Kepler-ish orbit + particle tail) ────────────────────────────
static const float COMET_A = 62.0f, COMET_E = 0.72f;
static const int   COMET_N = 140;

static float  cometTail[COMET_N * 3];
static float  cometJit[COMET_N * 3];
static float  cometHead[2];   // {x, z}
static double cometTheta = 2.4;

static inline float cometR(float theta) {
    return COMET_A * (1.0f - COMET_E * COMET_E) / (1.0f + COMET_E * cosf(theta));
}

// ── Exports ──────────────────────────────────────────────────────────────
extern "C" {

EMSCRIPTEN_KEEPALIVE
int gal_build(int n, uint32_t seed) {
    if (n < 1) n = 1;
    if (n > MAX_STARS) n = MAX_STARS;
    rngState = seed ? seed : 0x12345678u;
    int k = 0;

    // Spiral-arm stars (72%)
    int armN = (int)(n * 0.72f / ARMS);
    for (int arm = 0; arm < ARMS; arm++) {
        for (int i = 0; i < armN; i++, k++) {
            float t = sqrtf(rngF());
            float r, a;
            armPoint(arm, t, 1.0f, &r, &a);
            float thick = GAL_R * 0.045f * (1.0f - t * 0.7f);
            starPos[k*3]   = cosf(a) * r;
            starPos[k*3+1] = (rngF() - 0.5f) * thick;
            starPos[k*3+2] = sinf(a) * r;
            float edge = r / GAL_R;
            if (rngF() < 0.18f + edge * 0.25f)
                setHSL(&starCol[k*3], 0.58f + rngF() * 0.06f, 0.9f, 0.62f + rngF() * 0.22f);
            else
                setHSL(&starCol[k*3], 0.09f + edge * 0.46f, 0.8f, 0.5f + rngF() * 0.22f);
        }
    }
    // Scattered disc field stars (12%)
    int fieldEnd = k + (int)(n * 0.12f);
    for (; k < fieldEnd && k < n; k++) {
        float t = sqrtf(rngF());
        float r = t * GAL_R, a = rngF() * TWO_PI;
        starPos[k*3]   = cosf(a) * r;
        starPos[k*3+1] = (rngF() - 0.5f) * GAL_R * 0.05f * (1.0f - t * 0.6f);
        starPos[k*3+2] = sinf(a) * r;
        setHSL(&starCol[k*3], 0.08f + rngF() * 0.5f, 0.55f, 0.45f + rngF() * 0.2f);
    }
    // Barred bulge (rest)
    for (; k < n; k++) {
        float rr = powf(rngF(), 1.7f) * BULGE_R;
        float u = rngF() * TWO_PI, v = acosf(2.0f * rngF() - 1.0f);
        float bx = rr * sinf(v) * cosf(u) * 1.65f;
        float bz = rr * sinf(v) * sinf(u) * 0.85f;
        const float ba = 0.5f, cb = cosf(ba), sb = sinf(ba);
        starPos[k*3]   = bx * cb - bz * sb;
        starPos[k*3+1] = rr * cosf(v) * 0.55f;
        starPos[k*3+2] = bx * sb + bz * cb;
        setHSL(&starCol[k*3], 0.10f + rngF() * 0.05f, 0.9f, 0.6f + rngF() * 0.25f);
    }

    // Dust lanes hugging the arms
    dustCount = n / 4 < MAX_DUST ? n / 4 : MAX_DUST;
    for (int i = 0; i < dustCount; i++) {
        int arm = i % ARMS;
        float t = 0.12f + powf(rngF(), 0.7f) * 0.85f;
        float r, a;
        armPoint(arm, t, 0.45f, &r, &a);
        float aa = a - 0.10f;
        dustPos[i*3]   = cosf(aa) * r;
        dustPos[i*3+1] = (rngF() - 0.5f) * GAL_R * 0.02f;
        dustPos[i*3+2] = sinf(aa) * r;
    }
    return n;
}

EMSCRIPTEN_KEEPALIVE float* gal_star_pos()  { return starPos; }
EMSCRIPTEN_KEEPALIVE float* gal_star_col()  { return starCol; }
EMSCRIPTEN_KEEPALIVE float* gal_dust_pos()  { return dustPos; }
EMSCRIPTEN_KEEPALIVE int    gal_dust_count(){ return dustCount; }

EMSCRIPTEN_KEEPALIVE
void comet_init(uint32_t seed) {
    rngState = seed ? seed : 0xc0ffee42u;
    for (int i = 0; i < COMET_N * 3; i++) cometJit[i] = rngRange(-1.0f, 1.0f);
    cometTheta = 2.4;
}

EMSCRIPTEN_KEEPALIVE
void comet_step(double dt, double spin) {
    float r = cometR((float)cometTheta);
    cometTheta += (360.0 / (double)(r * r)) * spin * dt;  // fast at perihelion
    r = cometR((float)cometTheta);
    float px = cosf((float)cometTheta) * r;
    float pz = sinf((float)cometTheta) * r;
    cometHead[0] = px;
    cometHead[1] = pz;

    // Tail points away from the Sun (origin); longer when closer
    float dx = px / r, dz = pz / r;
    float len = 420.0f / r;
    if (len < 3.0f) len = 3.0f;
    if (len > 16.0f) len = 16.0f;
    for (int i = 0; i < COMET_N; i++) {
        float t = (float)i / COMET_N;
        float w = t * len * 0.14f;
        cometTail[i*3]   = px + dx * t * len + cometJit[i*3]   * w;
        cometTail[i*3+1] =                    cometJit[i*3+1] * w;
        cometTail[i*3+2] = pz + dz * t * len + cometJit[i*3+2] * w;
    }
}

EMSCRIPTEN_KEEPALIVE float* comet_head() { return cometHead; }
EMSCRIPTEN_KEEPALIVE float* comet_tail() { return cometTail; }

}  // extern "C"
