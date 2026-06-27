"""
emotion_engine.py  —  Stage 7
------------------------------
Upgrades from Stage 5:
  1. Removed py-feat entirely.
  2. Integrated MediaPipe's 52 face blendshapes directly into the engine
     to act as free, lightweight Action Unit (AU) proxies.
  3. Replaced `_feat_aus_to_scores` with `_blendshapes_to_scores`.
"""

import math
import time
import threading
import numpy as np
from collections import deque
from typing import Optional

# ── HuggingFace emotion model ─────────────────────────────────────────────────
# Loaded in a background thread so startup is instant.
# _hf_emotion is None until the thread finishes; the engine tolerates this.
_hf_emotion   = None
HF_AVAILABLE  = False   # set True once the background load succeeds
_hf_load_lock = threading.Lock()

def _load_hf_model():
    global _hf_emotion, HF_AVAILABLE
    try:
        from transformers import pipeline as hf_pipeline
        from PIL import Image
        import torch
        import numpy as _np

        # Limit PyTorch to 2 threads — prevents it fighting MediaPipe + audio
        # thread for CPU cores and reduces scheduling overhead.
        torch.set_num_threads(2)

        model = hf_pipeline(
            "image-classification",
            model  = "trpakov/vit-face-expression",
            device = -1,    # CPU; change to 0 for GPU
            top_k  = None,  # return all labels
        )

        # Warmup: run one dummy inference so PyTorch JIT-compiles its kernels
        # now, not on the first real frame during calibration.
        _dummy = Image.fromarray(_np.zeros((224, 224, 3), dtype=_np.uint8))
        model([_dummy])

        with _hf_load_lock:
            _hf_emotion  = model
            HF_AVAILABLE = True
        print("✔  HuggingFace emotion model ready (warmed up).")
    except Exception as _e:
        print(f"⚠  HuggingFace model not available ({_e}).")
        print("   Install with: pip install transformers torch pillow")

threading.Thread(target=_load_hf_model, daemon=True, name="hf-loader").start()
print("⟳  HuggingFace model loading in background…")


# ─────────────────────────────────────────────────────────────────────────────
# Landmark index constants  (kept for geometry fallback + EAR + PnP)
# ─────────────────────────────────────────────────────────────────────────────
class LM:
    BROW_L_INNER = 55;  BROW_R_INNER = 285
    BROW_L_MID   = 52;  BROW_R_MID   = 282
    BROW_L_OUTER = 46;  BROW_R_OUTER = 276
    L_EYE_TOP = 159;    L_EYE_BOT = 145
    L_EYE_INN = 133;    L_EYE_OUT = 33
    R_EYE_TOP = 386;    R_EYE_BOT = 374
    R_EYE_INN = 362;    R_EYE_OUT = 263
    NOSE_L = 129;       NOSE_R = 358
    LIP_L = 61;         LIP_R = 291
    LIP_TOP = 13;       LIP_BOT = 14
    CHIN = 152


# ─────────────────────────────────────────────────────────────────────────────
# Geometry helpers
# ─────────────────────────────────────────────────────────────────────────────
def d3(p1, p2) -> float:
    return math.sqrt(
        (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2)

def _ear_single(lm, top, bot, inn, out) -> float:
    return d3(lm[top], lm[bot]) / (d3(lm[inn], lm[out]) + 1e-7)

def _norm_personal(val: float, lo: float, hi: float) -> float:
    span = hi - lo
    if span < 1e-9:
        return 0.0
    return float(np.clip((val - lo) / span * 100.0, 0.0, 100.0))

def _norm_fixed(val: float, range_lo: float, range_hi: float) -> float:
    span = range_hi - range_lo
    if span < 1e-9:
        return 0.0
    return float(np.clip((val - range_lo) / span * 100.0, 0.0, 100.0))

def _pose_confidence(yaw: float, pitch: float) -> float:
    return float(
        np.clip(1.0 - abs(yaw) / 35.0, 0, 1) *
        np.clip(1.0 - abs(pitch) / 30.0, 0, 1)
    )


# ─────────────────────────────────────────────────────────────────────────────
# EMA alphas
# ─────────────────────────────────────────────────────────────────────────────
_EMA_ALPHA = {
    "discomfort": 0.45,   # faster convergence — was 0.60, causing ~150-frame ramp lag
    "confidence": 0.68,
    "confusion":  0.65,
    "engagement": 0.68,
}

EMOTION_KEYS = ["discomfort", "confidence", "confusion", "engagement"]

# ── HuggingFace label → our 4 dimensions ─────────────────────────────────────
# Model: trpakov/vit-face-expression (ViT trained on FER2013 + MMI + AffectNet)
# Labels (lowercased): angry, disgust, fear, happy, sad, surprise, neutral, contempt
# contempt is mapped as a strong discomfort/low-confidence signal — it's the
# most interview-relevant suppressed negative emotion the old model couldn't detect.
# Weights are raw — each dim is independently normalised by its weight sum.
_HF_MAP = {
    "discomfort": {
        "angry": 0.30, "disgust": 0.25, "fear": 0.20,
        "sad": 0.15,   "contempt": 0.10,
    },
    "confidence": {
        "happy": 0.55, "neutral": 0.30, "surprise": 0.05,
        "angry": -0.20, "fear": -0.15, "sad": -0.10,
        "disgust": -0.10, "contempt": -0.15,
    },
    "confusion": {
        "surprise": 0.50, "fear": 0.30, "disgust": 0.10, "sad": 0.10,
    },
    "engagement": {
        "happy": 0.50, "surprise": 0.30, "neutral": 0.20,
        "sad": -0.20, "fear": -0.10, "contempt": -0.15,
    },
}

def _hf_to_scores(hf_results: list) -> dict:
    probs = {r["label"].lower(): r["score"] for r in hf_results}
    out   = {}
    for dim, weights in _HF_MAP.items():
        # Separate positive and negative weights
        pos_w   = {l: w for l, w in weights.items() if w > 0}
        neg_w   = {l: w for l, w in weights.items() if w < 0}
        pos_sum = sum(pos_w.values()) or 1.0
        # Positive contribution (0–100 range from positive labels)
        pos_val = sum(probs.get(l, 0.0) * w for l, w in pos_w.items()) / pos_sum * 100
        # Negative penalty (subtract proportionally, max 40-point penalty)
        neg_pen = sum(probs.get(l, 0.0) * abs(w) for l, w in neg_w.items()) * 80 if neg_w else 0
        out[dim] = float(np.clip(pos_val - neg_pen, 0, 100))

    # Confidence: neutral face is a valid interview state (~50).
    # Scale dynamically: pure neutral → 50, pure happy → 80, negative → drops.
    dominant = max(probs, key=probs.get) if probs else "neutral"
    if dominant == "neutral":
        neutral_p = probs.get("neutral", 0.5)
        out["confidence"] = float(np.clip(40.0 + neutral_p * 25.0, 40, 65))
    elif dominant == "happy":
        happy_p = probs.get("happy", 0.5)
        out["confidence"] = float(np.clip(55.0 + happy_p * 30.0, 55, 85))
    # else: leave computed value (negative expression → naturally low)

    # Discomfort: HF model is bad at detecting subtle neutral-face interview stress.
    # A neutral face in an interview DOES carry baseline stress (~12).
    # Floor hf_dis so it never suppresses the blendshape signal below 12.
    out["discomfort"] = max(out["discomfort"], 12.0)
    return out


# ── MediaPipe Blendshapes → our 4 dimensions ─────────────────────────────────
def _blendshapes_to_scores(bs: dict,
                           neutral: Optional[dict] = None,
                           bs_range: Optional[dict] = None,
                           speaking: bool = False) -> dict:
    """
    Maps MediaPipe ARKit blendshapes to our 4-dim scores (0-100).

    neutral  — personal resting-face median (phase 0 of calibration).
    bs_range — per-key (neutral, ceiling) from active calibration gestures.
               When available, deltas are normalised to the person's own
               full expression range so a small-expression person and a
               large-expression person produce equivalent scores.
    speaking — when True, mouth-movement blendshapes (stretch, press, pucker)
               are suppressed so speech articulation doesn't bleed into the
               discomfort and confusion signals (Fix 2: mouth weight suppression).

    Fallback hierarchy:
      bs_range + neutral  →  fully normalised personal range  (best)
      neutral only        →  delta from neutral, global scale  (good)
      neither             →  absolute values × 5 rescale       (fallback)
    """
    def g(key, default=0.0):
        return float(bs.get(key, default))

    def delta(key, default=0.0):
        """Signed delta from personal neutral, normalised to personal range.
        Returns value in roughly [-1, +1] where:
          0   = at their personal neutral
         +1   = at their personal ceiling (max observed during calibration)
         -1   = as far below neutral as ceiling is above it
        In absolute fallback mode, rescales raw value × 5 for formula compat.
        """
        raw = float(bs.get(key, default))
        if neutral is None:
            return raw * 5.0   # absolute fallback rescale

        n = float(neutral.get(key, default))
        raw_delta = raw - n

        if bs_range is not None and key in bs_range:
            lo, hi = bs_range[key]
            span = max(hi - lo, 0.05)   # guaranteed non-zero by set_baselines
            return raw_delta / span      # normalised: 0=neutral, 1=ceiling
        else:
            return raw_delta             # un-normalised delta (neutral-only mode)

    def delta_pos(key, default=0.0):
        """Normalised delta clipped to >= 0: only counts increases above neutral."""
        return max(0.0, delta(key, default))

    # NOTE: delta_neg (decrease below neutral) is not used in current formulas —
    # positive signals like smile are handled via signed delta() directly.

    # ── Shared normalised delta values ───────────────────────────────────
    brow_down_d     = (delta_pos("browDownLeft")    + delta_pos("browDownRight"))    / 2.0
    nose_sneer_d    = (delta_pos("noseSneerLeft")   + delta_pos("noseSneerRight"))   / 2.0
    # FIX 2: mouth suppression during speech — mouthStretch and mouthPress
    # naturally activate during articulation and bleed into discomfort/confusion.
    # When speaking=True, zero them out so only brow/nose stress signals remain.
    _mouth_gate     = 0.0 if speaking else 1.0
    mouth_stretch_d = (delta_pos("mouthStretchLeft")+ delta_pos("mouthStretchRight"))/ 2.0 * _mouth_gate
    mouth_press_d   = (delta_pos("mouthPressLeft")  + delta_pos("mouthPressRight"))  / 2.0 * _mouth_gate
    cheek_squint_d  = (delta("cheekSquintLeft")     + delta("cheekSquintRight"))     / 2.0
    smile_d         = (delta("mouthSmileLeft")      + delta("mouthSmileRight"))      / 2.0
    brow_inner_up_d = delta_pos("browInnerUp")
    brow_outer_up_d = (delta_pos("browOuterUpLeft") + delta_pos("browOuterUpRight")) / 2.0
    mouth_pucker_d  = delta_pos("mouthPucker")
    jaw_open_d      = delta("jawOpen")
    eye_wide_d      = (delta("eyeWideLeft")         + delta("eyeWideRight"))         / 2.0
    eye_squint_d    = (delta("eyeSquintLeft")       + delta("eyeSquintRight"))       / 2.0

    # FIX 2: Facial asymmetry — suppressed emotions leak out asymmetrically.
    # Uses raw blendshape values (not deltas) so no calibration needed.
    # Typical resting asymmetry ≈ 0.01–0.03; stress leakage ≈ 0.05–0.15.
    # Maps to a 0–15 pt additive discomfort bonus.
    asymmetry = (
        abs(g("mouthSmileLeft")  - g("mouthSmileRight"))  * 0.30 +
        abs(g("browDownLeft")    - g("browDownRight"))     * 0.25 +
        abs(g("noseSneerLeft")   - g("noseSneerRight"))    * 0.25 +
        abs(g("cheekSquintLeft") - g("cheekSquintRight"))  * 0.20
    )
    asymmetry_bonus = float(np.clip(asymmetry * 100.0, 0, 15))

    # ── Discomfort ────────────────────────────────────────────────────────
    # Now purely delta-based: 0 means "at their personal resting level".
    # Use sqrt amplification so small deviations above neutral register.
    # Baseline of 20 = everyone has some interview stress above their rest.
    brow_down_s   = math.sqrt(np.clip(brow_down_d,     0, 1))
    nose_sneer_s  = math.sqrt(np.clip(nose_sneer_d,    0, 1))
    mouth_press_s = math.sqrt(np.clip(mouth_press_d,   0, 1))
    mouth_str_s   = math.sqrt(np.clip(mouth_stretch_d, 0, 1))
    discomfort_delta = (brow_down_s  * 0.35 + nose_sneer_s  * 0.30 +
                        mouth_str_s  * 0.20 + mouth_press_s * 0.15) * 100
    # 20 = personal interview baseline stress above their own resting face
    # Delta of 100 (impossible in practice) → score of 100
    # + asymmetry_bonus: additive signal from left/right blendshape divergence (0–15 pts)
    discomfort = 20.0 + discomfort_delta * 0.80 + asymmetry_bonus

    # ── Confidence ────────────────────────────────────────────────────────
    # 50 = their neutral face = baseline confidence.
    # Smile/cheek increase above neutral → more confident.
    # Brow-down/sneer/squint increase above neutral → less confident.
    negative_load = brow_down_d * 0.50 + nose_sneer_d * 0.30 + eye_squint_d * 0.20
    positive_expr = smile_d * 0.55 + cheek_squint_d * 0.45
    confidence = (50.0
                  + positive_expr * 50.0
                  - negative_load * 60.0)

    # ── Confusion ─────────────────────────────────────────────────────────
    # Brow raises ABOVE their neutral → confusion/surprise.
    # Person who naturally raises brows won't be penalised.
    brow_in_s  = math.sqrt(np.clip(brow_inner_up_d, 0, 1))
    brow_out_s = math.sqrt(np.clip(brow_outer_up_d, 0, 1))
    # pucker is also suppressed during speech — lips naturally purse when talking
    pucker_s   = math.sqrt(np.clip(mouth_pucker_d * _mouth_gate, 0, 1))
    confusion  = (brow_in_s * 0.40 + brow_out_s * 0.35 + pucker_s * 0.25) * 100

    # ── Engagement ────────────────────────────────────────────────────────
    # Eye openness relative to their neutral: if they naturally squint,
    # we don't penalise that. We only count squinting MORE than their rest.
    # 50 = neutral face = baseline engagement (they're present and looking forward).
    eye_open_delta = -eye_squint_d   # positive = eyes MORE open than neutral
    liveliness     = smile_d * 0.40 + cheek_squint_d * 0.30 + jaw_open_d * 0.30
    engagement     = 50.0 + (eye_open_delta * 0.45 + liveliness * 0.35 + eye_wide_d * 0.20) * 80

    return {
        "discomfort": float(np.clip(discomfort, 0, 100)),
        "confidence": float(np.clip(confidence, 0, 100)),
        "confusion":  float(np.clip(confusion,  0, 100)),
        "engagement": float(np.clip(engagement, 0, 100)),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main engine
# ─────────────────────────────────────────────────────────────────────────────
class EmotionEngine:

    _AUDIO_WINDOW_SAMPLES = 16000 * 3

    def __init__(self):
        # Warm-start at sensible midpoints so the display isn't jarring
        # before EMA converges. Confidence and engagement at 50 (neutral),
        # discomfort and confusion at 0 (no stress assumed until measured).
        self._scores = {
            "discomfort": 0.0,
            "confidence": 50.0,
            "confusion":  0.0,
            "engagement": 50.0,
        }
        # Micro-expression spike detector (Fix 1)
        # Keeps the last 3 raw values per dimension to detect sudden jumps.
        # When a spike is detected, EMA is temporarily bypassed so the
        # involuntary reaction registers before the person composes themselves.
        self._spike_buf   = {k: deque(maxlen=3) for k in EMOTION_KEYS}
        self._spike_decay = {k: 0 for k in EMOTION_KEYS}  # frames left to hold spike

        # ── Model result caches ───────────────────────────────────────────
        self._hf_result     = None
        self._hf_buffer = deque(maxlen=8)
        self._bs_result     = None   # cached MediaPipe blendshapes dict
        self._model_running = False
        self._frame_counter = 0
        self._run_every     = 6     

        # ── Audio state ───────────────────────────────────────────────────
        self._audio_accum   = np.zeros(0, dtype=np.float32)
        self._audio_lock    = threading.Lock()

        self.a_pitch  = 0.0
        self.a_rms    = 0.0
        self.a_zcr    = 0.0
        self.a_mfcc   = 0.0
        self.a_pause  = 0.0
        self.a_rate   = 0.0

        self.speaking      = False
        self.speak_start   = 0.0
        self.pause_cnt     = 0
        self.pause_timer   = time.time()
        self.speak_dur_buf = deque(maxlen=20)

        # ── Face buffers ──────────────────────────────────────────────────
        self.jitter_buf  = deque(maxlen=25)
        self.nod_buf     = deque(maxlen=30)
        self.ear_buf     = deque(maxlen=300)   # FIX: 300 frames ≈ 10s at 30fps; blink stress is better measured over a longer window
        self.ear_closed  = 0
        self.blink_count = 0
        self.gaze_buf    = deque(maxlen=60)
        self.prev_yaw    = 0.0
        self.prev_pitch  = 0.0

        self._silence_start   = 0.0
        self._is_thinking     = False

        self.mfcc_buf  = deque(maxlen=30)
        self.b_mfcc    = None
        self.b_ear     = 0.25

        self._cal: dict = {
            "au4":  (0.060, 0.110),
            "au1":  (0.005, 0.025),
            "au2":  (0.005, 0.025),
            "au9":  (0.035, 0.060),
            "au25": (0.005, 0.030),
        }

        # Personal blendshape neutral — captured during calibration.
        # Each key = blendshape name, value = median score at rest.
        # Until calibration runs, this is None and _blendshapes_to_scores
        # falls back to absolute scoring (old behaviour).
        self._bs_neutral: Optional[dict] = None

        # Personal blendshape range — per-key (neutral_median, ceiling_median).
        # Ceiling = observed peak during active calibration gestures.
        # Allows normalising each person's delta to their own 0-100 range
        # instead of assuming everyone's max expression is the same.
        self._bs_range: Optional[dict] = None   # {key: (neutral, ceiling)}

    # ─────────────────────────────────────────────────────────────────────
    # Calibration
    # ─────────────────────────────────────────────────────────────────────
    def collect_calib_frame(self, lm, blendshapes: Optional[dict] = None) -> dict:
        frame = {
            "au4":  d3(lm[LM.BROW_L_INNER], lm[LM.BROW_R_INNER]),
            "au1":  (lm[LM.L_EYE_INN].y - lm[LM.BROW_L_MID].y +
                     lm[LM.R_EYE_INN].y - lm[LM.BROW_R_MID].y) / 2.0,
            "au2":  (lm[LM.L_EYE_OUT].y - lm[LM.BROW_L_OUTER].y +
                     lm[LM.R_EYE_OUT].y - lm[LM.BROW_R_OUTER].y) / 2.0,
            "au9":  d3(lm[LM.NOSE_L], lm[LM.NOSE_R]),
            "au25": d3(lm[LM.LIP_TOP], lm[LM.LIP_BOT]),
        }
        if blendshapes:
            frame["_bs"] = blendshapes   # store full bs dict for baseline computation
        return frame

    def set_baselines(self, calib_frames, ears, audio_mfcc_vectors=None,
                      brow_frames=None, smile_frames=None):
        for key in ["au4", "au1", "au2", "au9", "au25"]:
            vals = [f[key] for f in calib_frames if key in f]
            if len(vals) < 3:
                continue
            arr  = np.array(vals)
            p10  = float(np.percentile(arr, 10))
            p90  = float(np.percentile(arr, 90))
            span = max(p90 - p10, 1e-6)
            self._cal[key] = (p10, p10 + 2.0 * span)

        if ears and len(ears) >= 3:
            arr        = np.array(ears)
            self.b_ear = float(np.median(arr))

        if audio_mfcc_vectors and len(audio_mfcc_vectors) >= 2:
            self.b_mfcc = np.median(np.stack(audio_mfcc_vectors), axis=0)

        # ── Personal blendshape neutral ───────────────────────────────────
        bs_frames = [f["_bs"] for f in calib_frames if "_bs" in f]
        if len(bs_frames) >= 5:
            all_keys = bs_frames[0].keys()
            self._bs_neutral = {
                k: float(np.median([frame[k] for frame in bs_frames if k in frame]))
                for k in all_keys
            }
            print(f"✔  Personal neutral captured ({len(bs_frames)} frames).")
            for k in ["browDownLeft", "noseSneerLeft", "mouthSmileLeft",
                      "eyeSquintLeft", "browInnerUp"]:
                if k in self._bs_neutral:
                    print(f"     {k}: {self._bs_neutral[k]:.4f}")
        else:
            self._bs_neutral = None
            print("⚠  Not enough frames for personal neutral — falling back.")

        # ── Personal blendshape range (active calibration) ────────────────
        # For each blendshape we store (neutral_median, ceiling_median).
        # ceiling = peak value observed during the relevant active gesture.
        # This allows _blendshapes_to_scores to normalise each person's delta
        # to their own full 0–100 range instead of assuming a global max.
        #
        # If active phases weren't provided, ceiling defaults to neutral + 0.30
        # (a reasonable universal fallback that avoids division by zero).
        if self._bs_neutral is None:
            self._bs_range = None
            return

        FALLBACK_SPAN = 0.12   # assumed max delta if no active calib

        def _ceiling(phase_frames, keys_of_interest):
            """Return per-key median of the top-25th-percentile frames
            from a gesture phase — robust peak estimate."""
            if not phase_frames or len(phase_frames) < 3:
                return {}
            ceilings = {}
            for k in keys_of_interest:
                vals = [f[k] for f in phase_frames if k in f]
                if len(vals) < 3:
                    continue
                # Take median of top 25% — avoids single-frame outliers
                arr = np.array(vals)
                threshold = np.percentile(arr, 75)
                peak_vals = arr[arr >= threshold]
                ceilings[k] = float(np.median(peak_vals))
            return ceilings

        # Keys exercised by each gesture
        BROW_KEYS  = ["browInnerUp", "browOuterUpLeft", "browOuterUpRight",
                      "eyeWideLeft", "eyeWideRight"]
        SMILE_KEYS = ["mouthSmileLeft", "mouthSmileRight",
                      "cheekSquintLeft", "cheekSquintRight"]

        brow_ceilings  = _ceiling(brow_frames,  BROW_KEYS)  if brow_frames  else {}
        smile_ceilings = _ceiling(smile_frames, SMILE_KEYS) if smile_frames else {}
        all_ceilings   = {**brow_ceilings, **smile_ceilings}

        self._bs_range = {}
        for k, neutral_val in self._bs_neutral.items():
            if k in all_ceilings:
                ceiling = all_ceilings[k]
            else:
                ceiling = neutral_val + FALLBACK_SPAN

            # Ensure span is never zero (would cause div/0 in normalisation)
            span = max(ceiling - neutral_val, 0.05)
            self._bs_range[k] = (neutral_val, neutral_val + span)

        print(f"✔  Personal blendshape range calibrated. Key ceilings:")
        for k in ["browInnerUp", "mouthSmileLeft", "cheekSquintLeft",
                  "eyeWideLeft", "browOuterUpLeft"]:
            if k in self._bs_range:
                lo, hi = self._bs_range[k]
                print(f"     {k}: neutral={lo:.3f}  ceiling={hi:.3f}  "
                      f"span={hi-lo:.3f}")

    def get_ear(self, lm) -> float:
        el = _ear_single(lm, LM.L_EYE_TOP, LM.L_EYE_BOT, LM.L_EYE_INN, LM.L_EYE_OUT)
        er = _ear_single(lm, LM.R_EYE_TOP, LM.R_EYE_BOT, LM.R_EYE_INN, LM.R_EYE_OUT)
        return (el + er) / 2.0

    # ─────────────────────────────────────────────────────────────────────
    # Background model inference — HF with temporal score-median voting
    # ─────────────────────────────────────────────────────────────────────
    def _run_models(self, frame_bgr):
        try:
            if not HF_AVAILABLE: return
            import cv2
            from PIL import Image
            # Resize to 224x224 before converting — HF classifier expects this
            # size anyway; passing full 640x480 makes it resize internally and
            # wastes ~30% of inference time.
            small     = cv2.resize(frame_bgr, (224, 224), interpolation=cv2.INTER_LINEAR)
            frame_rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
            pil_img   = Image.fromarray(frame_rgb)

            # (Keeping the batch fix here to prevent formatting crashes!)
            hf_out = _hf_emotion([pil_img])
            results = hf_out[0] if isinstance(hf_out, list) and len(hf_out) > 0 and isinstance(hf_out[0], list) else hf_out
            
            # 1. Calculate scores for this exact frame
            current_frame_scores = _hf_to_scores(results)
            
            # 2. Add it to our rolling history buffer
            self._hf_buffer.append(current_frame_scores)
            
            # 3. Temporal Voting: Calculate the median across the buffer
            smoothed_scores = {}
            for k in EMOTION_KEYS:
                # Using median "outvotes" single anomalous frames instantly
                smoothed_scores[k] = float(np.median([b[k] for b in self._hf_buffer]))
                
            # The engine will now use this stable, smoothed consensus
            self._hf_result = smoothed_scores

        except Exception as e:
            self._hf_result = None
            print(f"DEBUG - HuggingFace thread crashed: {e}")
        finally:
            self._model_running = False

    # ─────────────────────────────────────────────────────────────────────
    # Audio analysis
    # ─────────────────────────────────────────────────────────────────────
    def analyze_audio(self, audio_chunk: np.ndarray, sr: int = 16000):
        import librosa  # lazy import — saves ~1-2s at startup
        if len(audio_chunk) == 0:
            return

        chunk_rms = float(np.sqrt(np.mean(audio_chunk ** 2)))

        if chunk_rms > 0.01:
            if not self.speaking:
                self.speaking    = True
                self.speak_start = time.time()
            self._is_thinking = False
        else:
            if self.speaking:
                self.speak_dur_buf.append(time.time() - self.speak_start)
                self.speaking = False
                self.pause_cnt += 1
                self._silence_start = time.time()
            if time.time() - self.pause_timer > 60.0:
                self.pause_cnt   = max(0, self.pause_cnt - 2)
                self.pause_timer = time.time()
            self.a_pause = float(np.clip(self.pause_cnt * 5, 0, 100))

            self._is_thinking = (time.time() - self._silence_start) < 2.5
            return

        with self._audio_lock:
            self._audio_accum = np.concatenate([self._audio_accum, audio_chunk])
            if len(self._audio_accum) > self._AUDIO_WINDOW_SAMPLES:
                self._audio_accum = self._audio_accum[-self._AUDIO_WINDOW_SAMPLES:]

            if len(self._audio_accum) < self._AUDIO_WINDOW_SAMPLES:
                return
            audio_data = self._audio_accum.copy()

        try:
            rms_frames = librosa.feature.rms(y=audio_data)[0]
            avg_rms    = float(np.mean(rms_frames))
            peak_rms   = float(np.max(rms_frames))

            pitches, mags = librosa.piptrack(y=audio_data, sr=sr)
            valid_pitches = pitches.flatten()[mags.flatten() > np.percentile(mags, 75)]
            if len(valid_pitches) > 10:
                self.a_pitch = float(np.clip(
                    _norm_fixed(float(np.std(valid_pitches)), 8, 80), 0, 100))

            if avg_rms > 1e-7:
                ratio      = peak_rms / avg_rms
                self.a_rms = float(np.clip(_norm_fixed(ratio, 1.0, 4.5), 0, 100))

            zcr       = float(np.mean(librosa.feature.zero_crossing_rate(y=audio_data)[0]))
            self.a_zcr = float(np.clip(_norm_fixed(zcr, 0.05, 0.28), 0, 100))

            mfcc      = librosa.feature.mfcc(y=audio_data, sr=sr, n_mfcc=13)
            mfcc_mean = np.mean(mfcc, axis=1)
            self.mfcc_buf.append(mfcc_mean)
            if self.b_mfcc is not None and len(self.mfcc_buf) >= 3:
                dist       = float(np.linalg.norm(
                    np.mean(np.stack(self.mfcc_buf), axis=0) - self.b_mfcc))
                self.a_mfcc = float(np.clip(_norm_fixed(dist, 5.0, 35.0), 0, 100))

            if len(self.speak_dur_buf) > 3:
                self.a_rate = float(np.clip(
                    abs(float(np.mean(self.speak_dur_buf)) - 2.5) / 2.5 * 100,
                    0, 100))
        except Exception:
            pass

    # ─────────────────────────────────────────────────────────────────────
    # Geometry fallback face scores (kept as backup)
    # ─────────────────────────────────────────────────────────────────────
    def _geometry_face_scores(self, lm, pose_w,
                              s_blink, s_jitter, s_nod,
                              s_gaze, s_tilt, s_open, s_fwd) -> dict:
        def cal(key, val):
            lo, hi = self._cal[key]
            return _norm_personal(val, lo, hi) * pose_w

        s_au4 = cal("au4", d3(lm[LM.BROW_L_INNER], lm[LM.BROW_R_INNER]))
        s_au1 = cal("au1", (lm[LM.L_EYE_INN].y - lm[LM.BROW_L_MID].y +
                             lm[LM.R_EYE_INN].y - lm[LM.BROW_R_MID].y) / 2.0)
        s_au2 = cal("au2", (lm[LM.L_EYE_OUT].y - lm[LM.BROW_L_OUTER].y +
                             lm[LM.R_EYE_OUT].y - lm[LM.BROW_R_OUTER].y) / 2.0)
        s_au9 = cal("au9", d3(lm[LM.NOSE_L], lm[LM.NOSE_R]))

        return {
            "discomfort": s_au4 * 0.30 + s_au9 * 0.20 + s_blink * 0.25 + s_jitter * 0.25,
            "confidence": float(np.clip(100 - s_gaze, 0, 100)),
            "confusion":  s_au1 * 0.30 + s_au2 * 0.25 + s_tilt  * 0.45,
            "engagement": s_nod * 0.35 + s_open * 0.30 + s_fwd  * 0.35,
        }

    # ─────────────────────────────────────────────────────────────────────
    # Per-frame update
    # ─────────────────────────────────────────────────────────────────────
    def update(self, lm, yaw: float, pitch_angle: float,
               clean_frame=None, blendshapes=None) -> dict:

        pose_w = _pose_confidence(yaw, pitch_angle)

        if blendshapes is not None:
            self._bs_result = blendshapes

        self._frame_counter += 1
        if (clean_frame is not None
                and not self._model_running
                and self._frame_counter >= self._run_every):
            self._frame_counter  = 0
            self._model_running  = True
            threading.Thread(
                target = self._run_models,
                args   = (clean_frame.copy(),),
                daemon = True,
            ).start()

        # Shared signals
        raw_ear = self.get_ear(lm)
        self.ear_buf.append(raw_ear)
        if raw_ear < 0.17:
            self.ear_closed += 1
        else:
            if self.ear_closed >= 2:
                self.blink_count += 1
            self.ear_closed = 0
        s_blink = float(np.clip(
            np.interp(abs(self.blink_count - 0.75), [0.1, 2.2], [0, 100]), 0, 100))
        if len(self.ear_buf) == self.ear_buf.maxlen:
            self.blink_count = 0

        s_jitter = 0.0
        if self.prev_yaw != 0.0:
            vel = math.sqrt((yaw - self.prev_yaw)**2 + (pitch_angle - self.prev_pitch)**2)
            self.jitter_buf.append(vel)
            w = np.linspace(0.5, 1.0, len(self.jitter_buf))
            s_jitter = float(np.clip(
                np.interp(float(np.average(list(self.jitter_buf), weights=w)),
                          [0.3, 3.2], [0, 100]), 0, 100))
        self.prev_yaw, self.prev_pitch = yaw, pitch_angle

        self.nod_buf.append(pitch_angle)
        s_nod = float(np.clip(
            np.interp(np.std(self.nod_buf) if len(self.nod_buf) > 5 else 0,
                      [0.5, 4.5], [0, 100]), 0, 100))

        self.gaze_buf.append(1.0 if (abs(yaw) > 22 or abs(pitch_angle) > 18) else 0.0)
        s_gaze = float(np.mean(self.gaze_buf)) * 100.0
        s_tilt = float(np.clip(np.interp(abs(yaw), [5, 22], [0, 100]), 0, 100))
        s_open = float(np.clip(
            (raw_ear - self.b_ear) / (self.b_ear + 1e-7) / 0.20 * 100, 0, 100))
        s_fwd = float(np.clip(np.interp(-pitch_angle, [3, 18], [0, 100]), 0, 100))

        # Face layer computation
        gaze_confidence = float(np.clip(100 - s_gaze, 0, 100))

        bs_base = None  # guard against NameError in debug block below

        if self._bs_result is not None:
            bs_base = _blendshapes_to_scores(
                self._bs_result,
                neutral  = self._bs_neutral,
                bs_range = self._bs_range,
                speaking = self.speaking,   # Fix 2: suppress mouth signals during speech
            )

            # Confidence: gaze steadiness (45%) + blendshape smile/composure (35%) + head steadiness (20%)
            # bs_base["confidence"] now centres at ~50 for neutral so this blends cleanly
            face_confidence = (
                gaze_confidence                          * 0.45 +
                bs_base["confidence"]                    * 0.35 +
                float(np.clip(100 - s_jitter, 0, 100))  * 0.20
            )

            # Floor: if face is visibly composed and head is steady, don't drop below 35
            if pose_w > 0.7 and bs_base["discomfort"] < 40:
                face_confidence = max(face_confidence, 35.0)

            # Discomfort: bs_base["discomfort"] is the primary signal (correctly amplified).
            # blink and jitter are ADDITIVE bonuses, not replacement weights —
            # they can only raise discomfort, never dilute the blendshape reading.
            # HF is used as a one-way booster via max(): it can raise discomfort when
            # it detects overt anger/disgust, but cannot suppress subtle blendshape stress.
            blink_bonus  = s_blink  / 100.0 * 15.0   # up to +15 at extreme blinking
            jitter_bonus = s_jitter / 100.0 * 10.0   # up to +10 at extreme head jitter
            face_raw_dis = float(np.clip(
                bs_base["discomfort"] + blink_bonus + jitter_bonus, 0, 100))
            hf_dis_boost = self._hf_result["discomfort"] if self._hf_result else 0.0
            face_raw = {
                "discomfort": max(face_raw_dis, hf_dis_boost),  # HF can only raise
                "confidence": face_confidence,
                # FIX 1: co-occurrence gate — confusion requires BOTH brow raise (bs_base)
                # AND head tilt (s_tilt) to be meaningfully active at the same time.
                # Geometric mean of normalised signals gates the output so either
                # signal alone produces near-zero confusion.  Prevents the metric
                # from sitting at 10-20 all session from incidental movement.
                "confusion":  (bs_base["confusion"] * 0.55 + s_tilt * 0.45) *
                              math.sqrt(
                                  float(np.clip(bs_base["confusion"] / 50.0, 0.0, 1.0)) *
                                  float(np.clip(s_tilt / 30.0, 0.0, 1.0))
                              ),
                # bs_base["engagement"] now starts at ~50 for neutral open-eyed face
                "engagement": (bs_base["engagement"] * 0.50 +
                               s_nod * 0.25 + s_open * 0.15 + s_fwd * 0.10),
            }
        else:
            geo = self._geometry_face_scores(
                lm, pose_w, s_blink, s_jitter, s_nod, s_gaze, s_tilt, s_open, s_fwd)
            geo["confidence"] = (
                gaze_confidence                         * 0.50 +
                geo["confidence"]                       * 0.20 +
                float(np.clip(100 - s_jitter, 0, 100)) * 0.30
            )
            # BUG 5 FIX: apply same HF discomfort boost in geo path
            if self._hf_result:
                geo["discomfort"] = max(geo["discomfort"], self._hf_result["discomfort"])
            face_raw = geo

        # Blend HF into face layer — but NOT discomfort (already handled via max() above)
        if self._hf_result is not None:
            face_layer = {
                k: (face_raw[k] * 0.60 + self._hf_result[k] * 0.40
                    if k != "discomfort" else face_raw[k])
                for k in EMOTION_KEYS
            }
        else:
            face_layer = face_raw

        # Audio layer
        # NOTE: audio_dis has a floor of 10 when silent — silence in an interview
        # context can itself signal tension, not absence of stress.
        voc_confidence = float(np.clip(
            (100 - self.a_pitch)  * 0.30 +
            self.a_rms            * 0.25 +
            (100 - self.a_mfcc)   * 0.25 +
            (100 - self.a_pause)  * 0.20,
            0, 100,
        ))

        audio_dis_raw = (self.a_pitch * 0.30 + self.a_rms   * 0.25 +
                         self.a_zcr   * 0.20 + self.a_pause * 0.25)
        audio_raw = {
            "discomfort": max(audio_dis_raw, 10.0),   # silent ≠ zero stress
            "confidence": voc_confidence,
            "confusion":  self.a_pause * 0.50 + self.a_rate   * 0.50,
            "engagement": float(np.clip(100 - self.a_pause, 0, 100)),
        }

        # BUG 6 FIX: audio features need 3s of speech to accumulate.
        # Don't give full audio weight until features are non-zero — otherwise
        # speaking starts with audio_w=1.0 but stale zero values, spuriously
        # boosting confidence to ~75 and diluting discomfort to ~10.
        has_audio_features = self.a_rms > 0.0 or self.a_pitch > 0.0
        audio_w = 1.0 if (self.speaking and has_audio_features) else 0.15
        face_w  = max(pose_w, 0.1)
        total_w = face_w + audio_w

        raw = {
            k: (face_layer[k] * face_w + audio_raw[k] * audio_w) / total_w
            for k in EMOTION_KEYS
        }

        if self._is_thinking and pitch_angle < -5:
            raw["discomfort"] *= 0.65   # gentle suppression only; 0.40 was too aggressive

        # ── Fix 1: Micro-expression spike detector ────────────────────────
        # The EMA smooths out everything — including genuine involuntary
        # micro-expressions that last only 2-3 frames (~100ms at 30fps).
        # Strategy: track last 3 raw values per dim. If the latest value
        # jumps >20pt above the recent average, treat it as a spike:
        #   - bypass EMA for this frame (use raw value directly)
        #   - hold the elevated score for 6 frames (~200ms) so it's
        #     visible in the session timeline before decaying normally.
        # Only fires on discomfort (most meaningful for interview coaching).
        SPIKE_THRESHOLD = 20.0   # pt jump to qualify as micro-expression
        SPIKE_HOLD      = 6      # frames to hold before normal EMA resumes

        for k, v in raw.items():
            clipped = float(np.clip(v, 0, 100))
            self._spike_buf[k].append(clipped)

            alpha = _EMA_ALPHA[k]

            if k == "discomfort" and len(self._spike_buf[k]) == 3:
                recent_avg = float(np.mean(list(self._spike_buf[k])[:-1]))
                jump       = clipped - recent_avg

                if jump > SPIKE_THRESHOLD and self._spike_decay[k] == 0:
                    # Spike detected — bypass EMA, register raw value instantly
                    self._scores[k]    = clipped
                    self._spike_decay[k] = SPIKE_HOLD
                elif self._spike_decay[k] > 0:
                    # Holding spike — slow decay back toward EMA
                    self._scores[k]    = self._scores[k] * 0.85 + clipped * 0.15
                    self._spike_decay[k] -= 1
                else:
                    # Normal EMA
                    self._scores[k] = self._scores[k] * alpha + clipped * (1.0 - alpha)
            else:
                # Non-discomfort dims: normal EMA always
                self._scores[k] = self._scores[k] * alpha + clipped * (1.0 - alpha)
            
        # Debug logging tracking
        hf_dis  = f"{self._hf_result['discomfort']:.1f}"  if self._hf_result else "---"
        hf_conf = f"{self._hf_result['confidence']:.1f}"  if self._hf_result else "---"
        bs_dis  = f"{bs_base['discomfort']:.1f}"          if bs_base else "---"
        bs_conf = f"{bs_base['confidence']:.1f}"          if bs_base else "---"
        bs_eng  = f"{bs_base['engagement']:.1f}"          if bs_base else "---"
        
        print(f"[DBG] bs={'ON' if self._bs_result else 'WAIT'} hf={'ON' if self._hf_result else 'WAIT'} | "
              f"bs_dis={bs_dis} bs_conf={bs_conf} bs_eng={bs_eng} | "
              f"hf_dis={hf_dis} hf_conf={hf_conf} | "
              f"final dis={self._scores['discomfort']:.1f} conf={self._scores['confidence']:.1f} eng={self._scores['engagement']:.1f}")

        return {k: int(self._scores[k]) for k in EMOTION_KEYS}

    def model_status(self) -> str:
        vote_n = len(self._hf_buffer)
        bs_s   = "BS:ON "   if self._bs_result is not None else "BS:WAIT "
        hf_s   = f"HF:ON(v{vote_n}) " if (HF_AVAILABLE and self._hf_result is not None) else \
                 "HF:WAIT "            if HF_AVAILABLE else "HF:OFF "
        aud_s  = "AUD:LIVE" if self.speaking else \
                 "AUD:THINK" if self._is_thinking else "AUD:SIL"
        return bs_s + hf_s + aud_s