/* Anti-Bully Sentry — Continuous Audio Inferencing + Directional Servo Response
 * + Dashboard Network Reporting
 *
 * Merged: dual-mic stereo capture -> mono feed to classifier + L/R RMS for direction
 *
 * NETWORKING ADDITIONS (marked NET):
 *   On every confirmed distress event the device:
 *     1. POSTs a telemetry record  -> appears on Live Monitoring page in real time
 *     2. POSTs a full alert        -> appears on Alerts page, fires Telegram notif
 *   A heartbeat is sent every 30s so the dashboard shows the device as "online".
 *   All HTTP calls run on Core 0 in a background FreeRTOS task — never blocks loop().
 *
 * DIRECTION FIX (marked FIX):
 *   1. RMS is now sampled into a short rolling history (per DMA read) instead of
 *      only ever reading the "live" g_rmsL/g_rmsR at the instant distress fires.
 *      The classifier scores a window that already happened, so by the time
 *      DISTRESS_THRESHOLD is crossed the "live" RMS may belong to a different
 *      moment. We instead pick the loudest entry in the recent history — the
 *      one most likely to be the actual scream.
 *   2. getSoundDirection() now uses a RATIO test (DIFF_THRESHOLD) instead of a
 *      fixed absolute RMS difference, so the decision scales with how loud the
 *      event actually was instead of being biased by overall volume.
 */

// NET: must be first — defines NETWORK_TASK_IMPL so the implementation
//      is compiled in this translation unit (and only this one)
#define NETWORK_TASK_IMPL
#include "network_config.h"
#include "network_task.h"

#include <AntiBullySentry-AudioClassifier_inferencing.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/i2s.h"
#include <ESP32Servo.h>
#include <math.h>

// ---------------- HARDWARE CONFIG ----------------
#define ALARM_PIN          2
#define DISTRESS_THRESHOLD 0.90
#define LOWER_SERVO_PIN    12
#define UPPER_SERVO_PIN    13
#define COOLDOWN_MS        1000
#define CONFIRM_FRAMES     1

#define LEFT_ANGLE   30
#define RIGHT_ANGLE  150
#define CENTER_ANGLE 90

#define AUDIO_GAIN        8
#define MIN_RMS_FLOOR     3000.0f
#define DIFF_THRESHOLD    1.15f   // FIX: now actually used, as a ratio (loud/quiet)
#define SWAP_LR_CHANNELS  0

// FIX: how far back (ms) we're willing to look in the RMS history when
// resolving direction for a detected distress event. Should roughly cover
// the classifier's model window latency; tune if misdirection persists.
#define RMS_HISTORY_LOOKBACK_MS 500
#define RMS_HISTORY_SIZE        20

// ---------------- AUDIO / CLASSIFIER BUFFERS ----------------
typedef struct {
    int16_t  *buffer;
    uint8_t   buf_ready;
    uint32_t  buf_count;
    uint32_t  n_samples;
} inference_t;

static inference_t    inference;
static const uint32_t sample_buffer_size = 2048;
static int32_t        rawStereoBuffer[sample_buffer_size / 2];
static signed short   monoBuffer[sample_buffer_size / 4];
static bool           debug_nn      = false;
static bool           record_status = true;

volatile float g_rmsL = 0;
volatile float g_rmsR = 0;

// FIX: rolling history of recent RMS samples, written once per I2S DMA read
// in capture_samples(). Lets us look back to the moment a loud event actually
// happened instead of trusting whatever the mics are picking up "right now".
struct RmsSample {
    float rmsL;
    float rmsR;
    unsigned long t;
};
volatile RmsSample rmsHistory[RMS_HISTORY_SIZE];
volatile int       rmsHistoryIndex = 0;

Servo lowerServo;
Servo upperServo;
int   lowerAngle     = 90;
int   upperAngle     = 90;
int   distressStreak = 0;
unsigned long lastMoveTime = 0;
bool  locked = false;

unsigned long lastRmsPrint = 0;
#define RMS_PRINT_INTERVAL_MS 250

unsigned long lastIdleNudge = 0;
#define IDLE_NUDGE_INTERVAL_MS 1500
bool idleNudgeState = false;

enum Direction { LEFT, RIGHT, CENTER, UNKNOWN };

static int print_results = -(EI_CLASSIFIER_SLICES_PER_MODEL_WINDOW);

// forward declarations
Direction getSoundDirection(float leftRMS, float rightRMS);
Direction getSoundDirectionFromHistory();
void      moveTo(int targetAngle);

// ---------------- SETUP ----------------
void setup() {
    Serial.begin(115200);
    while (!Serial);
    Serial.println("--- Anti-Bully Sentry: Directional Continuous Audio Detection ---");

    // NET: connect WiFi, sync NTP, launch background network task on Core 0
    networkInit();

    pinMode(ALARM_PIN, OUTPUT);
    digitalWrite(ALARM_PIN, LOW);

    lowerServo.attach(LOWER_SERVO_PIN);
    upperServo.attach(UPPER_SERVO_PIN);
    lowerServo.setPeriodHertz(50);
    upperServo.setPeriodHertz(50);
    lowerServo.write(90);
    upperServo.write(90);
    delay(300);

    if (microphone_inference_start(EI_CLASSIFIER_SLICE_SIZE) == false) {
        ei_printf("ERR: Could not allocate audio buffer!\r\n");
        return;
    }

    ei_printf("System Armed & Listening... Scream 'HELP' or 'TOLONG' to test!\n");
}

// ---------------- MAIN LOOP ----------------
void loop() {
    bool m = microphone_inference_record();
    if (!m) {
        ei_printf("ERR: Failed to record audio...\n");
        return;
    }

    unsigned long nowDbg = millis();
    if (nowDbg - lastRmsPrint >= RMS_PRINT_INTERVAL_MS) {
        Serial.print("[calib] rmsL=");
        Serial.print(g_rmsL);
        Serial.print(" rmsR=");
        Serial.println(g_rmsR);
        lastRmsPrint = nowDbg;
    }

    signal_t signal;
    signal.total_length = EI_CLASSIFIER_SLICE_SIZE;
    signal.get_data     = &microphone_audio_signal_get_data;
    ei_impulse_result_t result = { 0 };

    EI_IMPULSE_ERROR r = run_classifier_continuous(&signal, &result, debug_nn, true);
    if (r != EI_IMPULSE_OK) {
        ei_printf("ERR: Failed to run classifier (%d)\n", r);
        return;
    }

    unsigned long now = millis();
    if (locked) {
        if (now - lastMoveTime >= COOLDOWN_MS) {
            locked        = false;
            distressStreak = 0;
            Serial.println("Cooldown ended, listening again.");
        }
    }

    for (size_t ix = 0; ix < EI_CLASSIFIER_LABEL_COUNT; ix++) {
        if (strcmp(result.classification[ix].label, "distress") == 0) {
            float distress_score = result.classification[ix].value;

            if (distress_score >= DISTRESS_THRESHOLD) {
                digitalWrite(ALARM_PIN, HIGH);
                ei_printf("\n========================================\n");
                ei_printf(" [!] DISTRESS DETECTED! (Score: %.2f) [!]\n", distress_score);
                ei_printf("========================================\n\n");

                if (!locked) {
                    distressStreak++;
                    Serial.print("Distress streak: ");
                    Serial.println(distressStreak);

                    if (distressStreak >= CONFIRM_FRAMES) {
                        // FIX: was getSoundDirection(g_rmsL, g_rmsR) — an instant
                        // snapshot that could be from the wrong moment. Now we
                        // scan recent history for the loudest moment instead.
                        Direction dir = getSoundDirectionFromHistory();

                        if (dir == LEFT) {
                            Serial.println(">>> Moving LEFT");
                            moveTo(LEFT_ANGLE);
                            delay(500);  // Let servo settle + CAM sensor refresh frames
                            lastMoveTime   = now;
                            locked         = true;
                            distressStreak = 0;
                            // NET: queue the alert — non-blocking, handled on Core 0
                            networkQueueAlert(distress_score, (int)LEFT);

                        } else if (dir == RIGHT) {
                            Serial.println(">>> Moving RIGHT");
                            moveTo(RIGHT_ANGLE);
                            delay(500);  // Let servo settle + CAM sensor refresh frames
                            lastMoveTime   = now;
                            locked         = true;
                            distressStreak = 0;
                            // NET: queue the alert — non-blocking, handled on Core 0
                            networkQueueAlert(distress_score, (int)RIGHT);

                        } else if (dir == CENTER) {
                            Serial.println(">>> Moving CENTER");
                            moveTo(CENTER_ANGLE);
                            delay(500);  // Let servo settle + CAM sensor refresh frames
                            lastMoveTime   = now;
                            locked         = true;
                            distressStreak = 0;
                            // NET: queue the alert — non-blocking, handled on Core 0
                            networkQueueAlert(distress_score, (int)CENTER);

                        } else {
                            Serial.println("UNKNOWN (too quiet, waiting for clearer signal)");
                            // UNKNOWN = direction unclear, don't fire alert
                        }
                    }
                }
            } else {
                digitalWrite(ALARM_PIN, LOW);
                distressStreak = 0;
            }
        }
    }

    if (++print_results >= (EI_CLASSIFIER_SLICES_PER_MODEL_WINDOW >> 1)) {
        ei_printf("Status -> distress: %.2f | non_distress: %.2f\n",
                  result.classification[0].value,
                  result.classification[1].value);
        print_results = 0;
    }
}

// ---------------- DIRECTION LOGIC ----------------

// FIX: scans the last RMS_HISTORY_LOOKBACK_MS of recorded RMS samples and
// picks the entry with the highest combined energy (L+R) — i.e. the moment
// most likely to be the actual distress sound, not whatever the mics happen
// to be picking up at the exact instant the classifier's score crossed
// threshold (which can lag the real event by a full model window).
Direction getSoundDirectionFromHistory() {
    float bestEnergy = -1.0f;
    float bestL = 0, bestR = 0;
    unsigned long nowMs  = millis();
    unsigned long cutoff = (nowMs > RMS_HISTORY_LOOKBACK_MS)
                                ? (nowMs - RMS_HISTORY_LOOKBACK_MS)
                                : 0;

    for (int i = 0; i < RMS_HISTORY_SIZE; i++) {
        // volatile struct copy — brief read, history is small so this is cheap
        float l = rmsHistory[i].rmsL;
        float rr = rmsHistory[i].rmsR;
        unsigned long t = rmsHistory[i].t;

        if (t < cutoff) continue;

        float energy = l + rr;
        if (energy > bestEnergy) {
            bestEnergy = energy;
            bestL = l;
            bestR = rr;
        }
    }

    Serial.print("[dir] best-in-window L: "); Serial.print(bestL);
    Serial.print(" R: "); Serial.println(bestR);

    return getSoundDirection(bestL, bestR);
}

// FIX: ratio-based comparison instead of a fixed absolute RMS difference, so
// the decision scales with how loud the event was rather than being biased
// toward LEFT/RIGHT at high volume or toward CENTER at low volume.
Direction getSoundDirection(float leftRMS, float rightRMS) {
    if (leftRMS < MIN_RMS_FLOOR && rightRMS < MIN_RMS_FLOOR)
        return UNKNOWN;

    float loud  = max(leftRMS, rightRMS);
    float quiet = max(min(leftRMS, rightRMS), 1.0f);  // avoid div-by-zero
    float ratio = loud / quiet;

    Serial.print("Ratio = ");
    Serial.println(ratio);

    if (ratio < DIFF_THRESHOLD) return CENTER;
    return (leftRMS > rightRMS) ? LEFT : RIGHT;
}

// ---------------- SERVO SWEEP ----------------
void moveTo(int targetAngle) {
    Serial.println("======================");
    Serial.print("Moving Servo To: ");
    Serial.println(targetAngle);
    for (int i = 0; i < 30; i++) {
        lowerServo.write(targetAngle);
        delay(10);
    }
    lowerAngle = targetAngle;
    Serial.println("Servo Movement Done");
    Serial.println("======================");
}

// ---------------- AUDIO CAPTURE (STEREO I2S) ----------------
static void audio_inference_callback(uint32_t n_bytes) {
    for (int i = 0; i < (int)(n_bytes >> 1); i++) {
        inference.buffer[inference.buf_count++] = monoBuffer[i];
        if (inference.buf_count >= inference.n_samples) {
            inference.buf_count = 0;
            inference.buf_ready = 1;
        }
    }
}

static void capture_samples(void* arg) {
    const int32_t i2s_bytes_to_read = (uint32_t)(uintptr_t)arg;
    size_t bytes_read = i2s_bytes_to_read;

    while (record_status) {
        i2s_read((i2s_port_t)1, (void*)rawStereoBuffer,
                 i2s_bytes_to_read, &bytes_read, 100);

        if (bytes_read <= 0) {
            ei_printf("Error in I2S read : %d", (int)bytes_read);
        } else {
            int     frames = (bytes_read / 4) / 2;
            int64_t sumL = 0, sumR = 0;

            for (int i = 0; i < frames; i++) {
#if SWAP_LR_CHANNELS
                int32_t leftRaw  = rawStereoBuffer[i * 2 + 1];
                int32_t rightRaw = rawStereoBuffer[i * 2];
#else
                int32_t leftRaw  = rawStereoBuffer[i * 2];
                int32_t rightRaw = rawStereoBuffer[i * 2 + 1];
#endif
                int16_t left  = (int16_t)(leftRaw  >> 16);
                int16_t right = (int16_t)(rightRaw >> 16);

                int32_t gainedLeft  = (int32_t)left  * AUDIO_GAIN;
                int32_t gainedRight = (int32_t)right * AUDIO_GAIN;

                sumL += (int64_t)gainedLeft  * gainedLeft;
                sumR += (int64_t)gainedRight * gainedRight;

                monoBuffer[i] = (int16_t)gainedLeft;
            }

            g_rmsL = sqrt((float)sumL / frames);
            g_rmsR = sqrt((float)sumR / frames);

            // FIX: latch this read's RMS into the rolling history so we can
            // later look back to find the actual loud moment, instead of
            // only ever having access to the very latest value.
            rmsHistory[rmsHistoryIndex].rmsL = g_rmsL;
            rmsHistory[rmsHistoryIndex].rmsR = g_rmsR;
            rmsHistory[rmsHistoryIndex].t    = millis();
            rmsHistoryIndex = (rmsHistoryIndex + 1) % RMS_HISTORY_SIZE;

            if (record_status) {
                audio_inference_callback(frames * 2);
            } else {
                break;
            }
        }
    }
    vTaskDelete(NULL);
}

static bool microphone_inference_start(uint32_t n_samples) {
    inference.buffer = (int16_t*)malloc(n_samples * sizeof(int16_t));
    if (!inference.buffer) return false;

    inference.buf_count = 0;
    inference.n_samples = n_samples;
    inference.buf_ready = 0;

    if (i2s_init(EI_CLASSIFIER_FREQUENCY)) {
        ei_printf("Failed to start I2S!");
    }
    ei_sleep(100);
    record_status = true;
    xTaskCreate(capture_samples, "CaptureSamples", 1024 * 32,
                (void*)(uintptr_t)(sample_buffer_size * 2), 10, NULL);
    return true;
}

static bool microphone_inference_record(void) {
    while (inference.buf_ready == 0) { delay(5); }
    inference.buf_ready = 0;
    return true;
}

static int microphone_audio_signal_get_data(size_t offset, size_t length,
                                              float* out_ptr) {
    numpy::int16_to_float(&inference.buffer[offset], out_ptr, length);
    return 0;
}

static void microphone_inference_end(void) {
    i2s_deinit();
    ei_free(inference.buffer);
}

static int i2s_init(uint32_t sampling_rate) {
    i2s_config_t i2s_config = {
        .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
        .sample_rate          = sampling_rate,
        .bits_per_sample      = (i2s_bits_per_sample_t)32,
        .channel_format       = I2S_CHANNEL_FMT_RIGHT_LEFT,
        .communication_format = I2S_COMM_FORMAT_I2S,
        .intr_alloc_flags     = 0,
        .dma_buf_count        = 8,
        .dma_buf_len          = 512,
        .use_apll             = false,
        .tx_desc_auto_clear   = false,
        .fixed_mclk           = -1,
    };
    i2s_pin_config_t pin_config = {
        .bck_io_num   = 26,
        .ws_io_num    = 25,
        .data_out_num = -1,
        .data_in_num  = 22,
    };
    esp_err_t ret;
    ret = i2s_driver_install((i2s_port_t)1, &i2s_config, 0, NULL);
    if (ret != ESP_OK) ei_printf("Error in i2s_driver_install");
    ret = i2s_set_pin((i2s_port_t)1, &pin_config);
    if (ret != ESP_OK) ei_printf("Error in i2s_set_pin");
    ret = i2s_zero_dma_buffer((i2s_port_t)1);
    if (ret != ESP_OK) ei_printf("Error in i2s_zero_dma_buffer");
    return (int)ret;
}

static int i2s_deinit(void) {
    i2s_driver_uninstall((i2s_port_t)1);
    return 0;
}
