"""
main_interview_room.py  —  Stage 8
------------------------------------
Changes from Stage 7:
  - R silently closes one question and starts the next — no mid-session
    output, no per-question JSON saved.  All question data is held in memory.
  - Q ends the interview.  A single full interview report is then printed
    with per-question breakdown + overall trends + coaching notes, and saved
    as interview_report.json.
  - _finish_session() no longer prints or saves — just stores the report.
"""

import os
os.environ["TF_CPP_MIN_LOG_LEVEL"]  = "3"   # suppress TF/oneDNN info + warnings
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"   # disable oneDNN (kills the port.cc spam)
os.environ["GLOG_minloglevel"]       = "3"   # suppress MediaPipe/absl logs

import cv2
import mediapipe as mp
import numpy as np
import time
import os
import urllib.request
import math
import sounddevice as sd

from emotion_engine   import EmotionEngine, LM, d3
from session_recorder import SessionRecorder

# ─────────────────────────────────────────────────────────────────────────────
# 1.  MediaPipe setup
# ─────────────────────────────────────────────────────────────────────────────
MODEL_PATH = "face_landmarker.task"
if not os.path.exists(MODEL_PATH):
    print("Downloading MediaPipe face landmarker model…")
    urllib.request.urlretrieve(
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/1/face_landmarker.task",
        MODEL_PATH,
    )

BaseOptions           = mp.tasks.BaseOptions
FaceLandmarker        = mp.tasks.vision.FaceLandmarker
FaceLandmarkerOptions = mp.tasks.vision.FaceLandmarkerOptions
VisionRunningMode     = mp.tasks.vision.RunningMode

latest_result = None

def on_face_result(result, _img, _ts):
    global latest_result
    latest_result = result

options = FaceLandmarkerOptions(
    base_options    = BaseOptions(model_asset_path=MODEL_PATH),
    running_mode    = VisionRunningMode.LIVE_STREAM,
    result_callback = on_face_result,
    output_face_blendshapes = True,  # ── ADDED FOR BLENDSHAPES
)

FACE_3D = np.array([
    [0.0,    0.0,    0.0  ],
    [0.0,  -330.0,  65.0  ],
    [-225.0, 170.0, 135.0 ],
    [ 225.0, 170.0, 135.0 ],
    [-150.0,-150.0, 125.0 ],
    [ 150.0,-150.0, 125.0 ],
], dtype=np.float64)

# ─────────────────────────────────────────────────────────────────────────────
# 2.  Engine + recorder
# ─────────────────────────────────────────────────────────────────────────────
engine   = EmotionEngine()
recorder = SessionRecorder()

# Question counter and collected reports.
# Each R press closes one question and silently stores its report.
# Nothing is printed or saved until Q is pressed.
question_number  = [1]   # list wrapper so with-block can mutate it
question_reports = []    # list of per-question report dicts

def _close_question(recorder: SessionRecorder) -> SessionRecorder:
    """
    Silently stop the current recorder, store its report in question_reports,
    then return a fresh recorder that is already started.
    Engine / calibration / camera / audio are NEVER restarted.
    """
    report = recorder.stop()
    question_reports.append(report)
    q = len(question_reports)
    ri = report["interview_readiness"]["score"]
    print(f"  ✔  Q{q} recorded ({report['duration_seconds']:.0f}s, "
          f"readiness {ri:.0f}%) — press R for next question, Q to finish.\n")

    new_rec = SessionRecorder()
    new_rec.start()
    return new_rec

# ─────────────────────────────────────────────────────────────────────────────
# 3.  Audio stream
# ─────────────────────────────────────────────────────────────────────────────
calib_mfcc_vecs = []

def audio_callback(indata, frames, time_info, status):
    if status:
        print(f"[Audio] {status}")
    engine.analyze_audio(indata.flatten().astype(np.float32))

audio_stream = sd.InputStream(
    callback   = audio_callback,
    channels   = 1,
    samplerate = 16000,
    blocksize  = 1600,
)

# ─────────────────────────────────────────────────────────────────────────────
# 4.  State
# ─────────────────────────────────────────────────────────────────────────────
cap            = cv2.VideoCapture(0)

# ── Calibration phases ────────────────────────────────────────────────────────
# Phase 0 — RELAX   : capture personal neutral baseline  (4 s)
# Phase 1 — BROWS   : raise eyebrows high, hold          (3 s)
# Phase 2 — SMILE   : smile naturally, hold              (3 s)
# Total: 10 s before tracking begins.
CALIB_PHASES = [
    {"name": "RELAX",  "duration": 4.0,
     "instruction": "  Relax and look at the camera",
     "color": (0, 90, 160)},
    {"name": "BROWS",  "duration": 3.0,
     "instruction": "  Raise your eyebrows HIGH and hold",
     "color": (0, 120, 60)},
    {"name": "SMILE",  "duration": 3.0,
     "instruction": "  Smile naturally and hold",
     "color": (100, 60, 0)},
]
TOTAL_CALIB   = sum(p["duration"] for p in CALIB_PHASES)

calib_phase       = 0          # index into CALIB_PHASES
calib_phase_start = time.time()
is_calibrated     = False

# Per-phase frame collectors
calib_frames      = []   # phase 0 — relax frames
calib_brow_frames = []   # phase 1 — brow raise frames
calib_smile_frames= []   # phase 2 — smile frames
calib_ears        = []
calib_mfcc_vecs   = []

session_start  = time.time()

FONT     = cv2.FONT_HERSHEY_SIMPLEX
C_WHITE  = (230, 230, 230)
C_GREY   = (150, 150, 150)
C_GREEN  = (50,  200,  80)
C_ORANGE = (30,  160, 230)
C_RED    = (30,   30, 230)
C_CYAN   = (200, 200,  50)


def val_color(v, invert=False):
    score = (100 - v) if invert else v
    if score > 70: return C_RED
    if score > 45: return C_ORANGE
    return C_GREEN

def draw_bar(frame, x, y, w, h, pct, color):
    cv2.rectangle(frame, (x, y), (x + w, y + h), (45, 45, 45), -1)
    fill = max(0, int(w * pct / 100))
    if fill > 0:
        cv2.rectangle(frame, (x, y), (x + fill, y + h), color, -1)


current_scores = {k: 0 for k in [
    "discomfort", "confidence", "confusion", "engagement",
]}

_t_start = time.time()
print("\n╔════════════════════════════════════════╗")
print("║  AI INTERVIEW ROOM  —  Stage 7         ║")
print("║  MP Blendshapes + HuggingFace Model    ║")
print("║  R = new session  |  Q = quit          ║")
print("╚════════════════════════════════════════╝")
print(f"  Camera + MediaPipe ready in {time.time()-_t_start:.1f}s")
print("  HuggingFace model loading in background (status shown in window)\n")
print(f"\nActive calibration — 3 phases, {int(TOTAL_CALIB)}s total.")
print("  Phase 0: Relax and look at camera (4s)")
print("  Phase 1: Raise eyebrows high (3s)")
print("  Phase 2: Smile naturally (3s)\n")

# ─────────────────────────────────────────────────────────────────────────────
# 5.  Main loop
# ─────────────────────────────────────────────────────────────────────────────
with audio_stream, FaceLandmarker.create_from_options(options) as landmarker:
    recorder.start()

    while True:
        key = cv2.waitKey(1) & 0xFF

        if key == ord("q"):
            break

        if key == ord("r") and is_calibrated:
            # ── Close question silently, start next ───────────────────────
            print(f"\n[R] Q{question_number[0]} done — recording next question…")
            recorder = _close_question(recorder)
            question_number[0] += 1

        ok, frame = cap.read()
        if not ok:
            break

        now     = time.time()
        elapsed = now - session_start
        frame   = cv2.flip(frame, 1)
        ih, iw  = frame.shape[:2]

        clean_frame = frame.copy()

        landmarker.detect_async(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=frame),
            int(now * 1000),
        )

        cv2.rectangle(frame, (0, 0), (iw, 50), (12, 12, 12), -1)
        cv2.putText(frame, f"AI INTERVIEW ROOM  |  Q{question_number[0]}",
                    (14, 29), FONT, 0.56, C_WHITE, 2)
        cv2.putText(frame, "[R] New Session  [Q] Quit",
                    (14, 46), FONT, 0.30, C_CYAN, 1)
        m, s = divmod(int(elapsed), 60)
        cv2.putText(frame, f"{m:02d}:{s:02d}", (iw - 75, 29), FONT, 0.55, C_GREY, 1)

        if latest_result and latest_result.face_landmarks:
            lm = latest_result.face_landmarks[0]
            
            # ── Extracted Blendshapes dictionary ───────────────────────────
            bs_dict = None
            if latest_result.face_blendshapes:
                bs_list = latest_result.face_blendshapes[0]
                bs_dict = {cat.category_name: cat.score for cat in bs_list}
                
            if bs_dict and not hasattr(engine, '_bs_keys_printed'):
                print("[DBG] Blendshape keys sample:", list(bs_dict.items())[:6])
                engine._bs_keys_printed = True

            if not is_calibrated:
                phase_cfg      = CALIB_PHASES[calib_phase]
                phase_elapsed  = now - calib_phase_start
                phase_duration = phase_cfg["duration"]
                remaining      = int(phase_duration - phase_elapsed) + 1

                # ── Collect frames into the right bucket ──────────────────
                cf = engine.collect_calib_frame(lm, blendshapes=bs_dict)
                if calib_phase == 0:
                    calib_frames.append(cf)
                    calib_ears.append(engine.get_ear(lm))
                    if engine.mfcc_buf:
                        calib_mfcc_vecs.append(engine.mfcc_buf[-1].copy())
                elif calib_phase == 1:
                    calib_brow_frames.append(cf)
                elif calib_phase == 2:
                    calib_smile_frames.append(cf)

                # ── Advance or finish phase ───────────────────────────────
                if phase_elapsed >= phase_duration:
                    calib_phase += 1
                    calib_phase_start = now
                    if calib_phase >= len(CALIB_PHASES):
                        # All phases done — compute baselines
                        engine.set_baselines(
                            calib_frames       = calib_frames,
                            ears               = calib_ears,
                            audio_mfcc_vectors = calib_mfcc_vecs or None,
                            brow_frames        = [f["_bs"] for f in calib_brow_frames
                                                  if "_bs" in f],
                            smile_frames       = [f["_bs"] for f in calib_smile_frames
                                                  if "_bs" in f],
                        )
                        is_calibrated = True
                        print("✔  Calibration complete — tracking active."
                              " Press Q when done.\n")
                    else:
                        print(f"  → Phase {calib_phase}: "
                              f"{CALIB_PHASES[calib_phase]['instruction'].strip()}")

                # ── Draw calibration UI ───────────────────────────────────
                if not is_calibrated:
                    phase_cfg = CALIB_PHASES[calib_phase]   # re-read (may have advanced)
                    phase_elapsed  = now - calib_phase_start
                    phase_duration = phase_cfg["duration"]
                    remaining      = max(int(phase_duration - phase_elapsed) + 1, 1)
                    prog = int((phase_elapsed / phase_duration) * (iw - 4))

                    # Background banner
                    cv2.rectangle(frame, (0, 52), (iw, 100), phase_cfg["color"], -1)
                    # Progress bar
                    cv2.rectangle(frame, (2, 93), (2 + prog, 98),
                                  (0, 220, 255), -1)
                    # Phase indicator dots
                    for i, p in enumerate(CALIB_PHASES):
                        dot_x = iw - 22 - i * 18
                        dot_c = (0, 220, 255) if i == calib_phase else (80, 80, 80)
                        cv2.circle(frame, (dot_x, 62), 5, dot_c, -1)
                    # Instruction text
                    cv2.putText(frame,
                                f"PHASE {calib_phase + 1}/3 —"
                                f"{phase_cfg['instruction']}  ({remaining}s)",
                                (12, 80), FONT, 0.50, C_WHITE, 2)

            else:
                face_2d = np.array(
                    [[int(lm[i].x * iw), int(lm[i].y * ih)]
                     for i in [1, 199, 33, 263, 61, 291]],
                    dtype=np.float64,
                )
                cam_mx = np.array(
                    [[iw, 0, iw / 2], [0, iw, ih / 2], [0, 0, 1]],
                    dtype=np.float64,
                )
                pnp_ok, rvec, _ = cv2.solvePnP(
                    FACE_3D, face_2d, cam_mx,
                    np.zeros((4, 1), dtype=np.float64),
                )
                yaw = pitch_deg = 0.0
                if pnp_ok:
                    rmat, _   = cv2.Rodrigues(rvec)
                    pitch_deg = np.degrees(math.asin(-rmat[2, 0]))
                    yaw       = np.degrees(math.atan2(rmat[2, 1], rmat[2, 2]))

                # Passing the new blendshapes dictionary
                current_scores = engine.update(lm, yaw, pitch_deg,
                                               clean_frame=clean_frame,
                                               blendshapes=bs_dict)
                recorder.record(current_scores)

                px = iw - 215
                cv2.rectangle(frame, (px - 6, 52), (iw, ih), (16, 16, 16), -1)

                rows = [
                    ("Discomfort",  "discomfort",  True),
                    ("Confidence",  "confidence",  False),
                    ("Confusion",   "confusion",   True),
                    ("Engagement",  "engagement",  False),
                ]
                y = 76
                for label, key, high_is_bad in rows:
                    val = current_scores[key]
                    col = val_color(val, invert=not high_is_bad)
                    cv2.putText(frame, label, (px, y), FONT, 0.40, C_GREY, 1)
                    draw_bar(frame, px, y + 3, 140, 10, val, col)
                    cv2.putText(frame, f"{val:3d}%", (px + 145, y + 11),
                                FONT, 0.38, C_WHITE, 1)
                    y += 34

                dominant = max(
                    ["discomfort", "confusion"],
                    key=lambda k: current_scores[k],
                )
                dv = current_scores[dominant]
                cv2.rectangle(frame, (0, ih - 36), (px - 8, ih), (12, 12, 12), -1)
                cv2.putText(
                    frame,
                    f"Dominant: {dominant.title()}  {dv}%",
                    (10, ih - 12), FONT, 0.50, val_color(dv), 1,
                )

                wy = ih - 70
                if current_scores["discomfort"] > 72:
                    cv2.putText(frame, "[!] HIGH DISCOMFORT",
                                (10, wy), FONT, 0.52, C_RED, 2)
                    wy -= 26
                if abs(yaw) > 25 or abs(pitch_deg) > 20:
                    cv2.putText(frame, "[!] HEAD TURNED AWAY",
                                (10, wy), FONT, 0.52, C_ORANGE, 2)
                    wy -= 26
                if engine.get_ear(lm) < 0.15:
                    cv2.putText(frame, "[!] EYES CLOSED",
                                (10, wy), FONT, 0.52, C_CYAN, 2)
                    wy -= 26
                if current_scores["engagement"] < 25:
                    cv2.putText(frame, "[!] LOW ENGAGEMENT",
                                (10, wy), FONT, 0.52, C_ORANGE, 2)
                    wy -= 26
                if engine._is_thinking:
                    cv2.putText(frame, "[~] THINKING",
                                (10, wy), FONT, 0.52, C_GREY, 1)

        else:
            cv2.putText(frame, "No face detected — move closer",
                        (14, 80), FONT, 0.55, C_ORANGE, 1)

        cv2.imshow("AI Interview Room", frame)

# ─────────────────────────────────────────────────────────────────────────────
# 6.  End of session
# ─────────────────────────────────────────────────────────────────────────────
cap.release()
cv2.destroyAllWindows()

# Close the final question silently, then build full interview report
print("\nClosing final question…")
final_report = recorder.stop()
question_reports.append(final_report)
q = len(question_reports)
print(f"  ✔  Q{q} recorded ({final_report['duration_seconds']:.0f}s)\n")

print("Generating full interview report…\n")
interview = SessionRecorder.build_interview_report(question_reports)
SessionRecorder.print_interview_report(interview)
SessionRecorder.save_interview_report_json(interview, path="interview_report.json")
print("  React app can fetch it from http://localhost:8000/session/report\n")