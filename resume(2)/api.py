"""
api.py  —  Stage 9
--------------------
FastAPI server bridging the React frontend and the Python emotion engine.

React owns the camera — it captures frames from <video> and POSTs them here.
Python never opens a camera or window.

Endpoints:
    POST /session/start          — initialise engine + recorder, start calibration
    POST /session/frame          — receive base64 JPEG, run engine, return scores
    POST /session/next-question  — close current question silently, start next
    POST /session/end            — close final question, build + save interview report
    GET  /session/status         — is a report ready?
    GET  /session/report         — fetch the full interview report
    POST /session/clear          — wipe report (ready for next candidate)

Run with:
    uvicorn api:app --port 8000 --reload
"""

import os
os.environ["TF_CPP_MIN_LOG_LEVEL"]  = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"
os.environ["GLOG_minloglevel"]       = "3"

import base64
import json
import time
import threading
import numpy as np
import cv2
import mediapipe as mp
import urllib.request

from fastapi                    import FastAPI, HTTPException, Request
from fastapi.middleware.cors    import CORSMiddleware
from pydantic                   import BaseModel

from emotion_engine   import EmotionEngine
from session_recorder import SessionRecorder

# ── MediaPipe setup ───────────────────────────────────────────────────────────
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

FACE_3D = np.array([
    [0.0,    0.0,    0.0  ],
    [0.0,  -330.0,  65.0  ],
    [-225.0, 170.0, 135.0 ],
    [ 225.0, 170.0, 135.0 ],
    [-150.0,-150.0, 125.0 ],
    [ 150.0,-150.0, 125.0 ],
], dtype=np.float64)

# ── Session state (module-level, protected by a lock) ─────────────────────────
_lock            = threading.Lock()
_engine          = None
_recorder        = None
_landmarker      = None
_latest_result   = None
_is_calibrated   = False
_calib_phase     = 0
_calib_start     = 0.0
_calib_frames    = []
_calib_brow      = []
_calib_smile     = []
_calib_ears      = []
_question_number = 1
_question_reports= []
_session_active  = False
_current_scores  = {"discomfort":0,"confidence":50,"confusion":0,"engagement":50}

CALIB_PHASES = [
    {"name":"RELAX", "duration":4.0},
    {"name":"BROWS", "duration":3.0},
    {"name":"SMILE", "duration":3.0},
]
TOTAL_CALIB = sum(p["duration"] for p in CALIB_PHASES)

REPORT_PATH = "interview_report.json"

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="AI Interview Room API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET","POST"],
    allow_headers=["*"],
)

# ── Pydantic models ───────────────────────────────────────────────────────────
class FramePayload(BaseModel):
    image: str          # base64-encoded JPEG data-URL or raw base64

# ── Helpers ───────────────────────────────────────────────────────────────────
def _on_face_result(result, _img, _ts):
    global _latest_result
    _latest_result = result

def _make_landmarker():
    opts = FaceLandmarkerOptions(
        base_options           = BaseOptions(model_asset_path=MODEL_PATH),
        running_mode           = VisionRunningMode.LIVE_STREAM,
        result_callback        = _on_face_result,
        output_face_blendshapes= True,
    )
    return FaceLandmarker.create_from_options(opts)

def _decode_frame(b64: str) -> np.ndarray:
    """Decode a base64 data-URL or raw base64 string to a BGR numpy array."""
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    raw  = base64.b64decode(b64)
    arr  = np.frombuffer(raw, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)

def _get_head_pose(lm, iw, ih):
    """Return (yaw, pitch_deg, roll_deg) from 6 face landmarks."""
    IDXS = [1, 152, 263, 33, 287, 57]
    pts2d = np.array([(lm[i].x * iw, lm[i].y * ih) for i in IDXS], dtype=np.float64)
    focal  = iw
    cam_mtx= np.array([[focal,0,iw/2],[0,focal,ih/2],[0,0,1]], dtype=np.float64)
    ok, rvec, tvec = cv2.solvePnP(FACE_3D, pts2d, cam_mtx, None,
                                   flags=cv2.SOLVEPNP_ITERATIVE)
    if not ok:
        return 0.0, 0.0, 0.0
    rmat, _ = cv2.Rodrigues(rvec)
    sy = np.sqrt(rmat[0,0]**2 + rmat[1,0]**2)
    yaw   = float(np.degrees(np.arctan2(-rmat[2,0], sy)))
    pitch = float(np.degrees(np.arctan2(rmat[2,1], rmat[2,2])))
    roll  = float(np.degrees(np.arctan2(rmat[1,0], rmat[0,0])))
    return yaw, pitch, roll

# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/session/start")
def session_start():
    """Initialise a fresh engine + recorder and open the landmarker."""
    global _engine, _recorder, _landmarker, _is_calibrated
    global _calib_phase, _calib_start, _calib_frames, _calib_brow
    global _calib_smile, _calib_ears, _question_number, _question_reports
    global _session_active, _current_scores, _latest_result

    with _lock:
        if _landmarker:
            try: _landmarker.close()
            except: pass

        _engine          = EmotionEngine()
        _recorder        = SessionRecorder()
        _recorder.start()
        _landmarker      = _make_landmarker()
        _latest_result   = None
        _is_calibrated   = False
        _calib_phase     = 0
        _calib_start     = time.time()
        _calib_frames    = []
        _calib_brow      = []
        _calib_smile     = []
        _calib_ears      = []
        _question_number = 1
        _question_reports= []
        _session_active  = True
        _current_scores  = {"discomfort":0,"confidence":50,"confusion":0,"engagement":50}

    print("Session started — calibration phase 0 (RELAX)")
    return {"ok": True, "calibration": True, "phase": "RELAX", "total_calib": TOTAL_CALIB}


@app.post("/session/frame")
def session_frame(payload: FramePayload):
    """
    Receive a base64 JPEG from React, run MediaPipe + engine, return scores.
    React calls this every ~200ms during the interview.
    """
    global _is_calibrated, _calib_phase, _calib_start
    global _calib_frames, _calib_brow, _calib_smile, _calib_ears
    global _current_scores, _latest_result

    if not _session_active or _engine is None:
        raise HTTPException(status_code=400, detail="No active session. Call /session/start first.")

    frame_bgr = _decode_frame(payload.image)
    if frame_bgr is None:
        raise HTTPException(status_code=400, detail="Could not decode image.")

    ih, iw = frame_bgr.shape[:2]
    now    = time.time()

    # Send to MediaPipe (async — result arrives via callback)
    try:
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB,
                          data=cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
        _landmarker.detect_async(mp_img, int(now * 1000))
    except Exception as e:
        print(f"[WARN] MediaPipe detect_async error: {e}")

    result = _latest_result
    scores = dict(_current_scores)
    calib_status = None
    alerts = []

    try:
        if result and result.face_landmarks:
            lm = result.face_landmarks[0]
            bs_dict = None
            if result.face_blendshapes:
                bs_dict = {c.category_name: c.score for c in result.face_blendshapes[0]}

            yaw, pitch_deg, roll_deg = _get_head_pose(lm, iw, ih)

            if not _is_calibrated:
                # ── Calibration ────────────────────────────────────────────────
                phase_cfg      = CALIB_PHASES[_calib_phase]
                phase_elapsed  = now - _calib_start
                remaining      = max(0, phase_cfg["duration"] - phase_elapsed)

                cf = _engine.collect_calib_frame(lm, blendshapes=bs_dict)
                if _calib_phase == 0:
                    _calib_frames.append(cf)
                    _calib_ears.append(_engine.get_ear(lm))
                elif _calib_phase == 1:
                    _calib_brow.append(cf)
                elif _calib_phase == 2:
                    _calib_smile.append(cf)

                calib_status = {
                    "phase":     _calib_phase,
                    "name":      phase_cfg["name"],
                    "remaining": round(remaining, 1),
                    "total":     TOTAL_CALIB,
                }

                if phase_elapsed >= phase_cfg["duration"]:
                    _calib_phase += 1
                    _calib_start  = now
                    if _calib_phase >= len(CALIB_PHASES):
                        # set_baselines is the correct method name
                        # brow/smile frames need "_bs" key extracted
                        _engine.set_baselines(
                            calib_frames       = _calib_frames,
                            ears               = _calib_ears,
                            audio_mfcc_vectors = None,
                            brow_frames        = [f["_bs"] for f in _calib_brow  if "_bs" in f],
                            smile_frames       = [f["_bs"] for f in _calib_smile if "_bs" in f],
                        )
                        _is_calibrated = True
                        calib_status = None
                        print("Calibration complete — tracking started")
                    else:
                        calib_status["phase"] = _calib_phase
                        calib_status["name"]  = CALIB_PHASES[_calib_phase]["name"]
                        print(f"Calibration phase {_calib_phase}: {CALIB_PHASES[_calib_phase]['name']}")
            else:
                # ── Live tracking ──────────────────────────────────────────────
                # update() returns scores directly — get_scores() does not exist.
                # Pass frame_bgr as clean_frame so HuggingFace model gets invoked.
                raw = _engine.update(lm, yaw=yaw, pitch_angle=pitch_deg,
                                     clean_frame=frame_bgr,
                                     blendshapes=bs_dict)
                with _lock:
                    _current_scores = {k: int(round(v)) for k, v in raw.items()}
                    scores = dict(_current_scores)
                _recorder.record(scores)

                # Alerts
                if scores["discomfort"] > 72:
                    alerts.append("HIGH DISCOMFORT")
                if abs(yaw) > 25 or abs(pitch_deg) > 20:
                    alerts.append("HEAD TURNED AWAY")
                if _engine.get_ear(lm) < 0.15:
                    alerts.append("EYES CLOSED")
                if scores["engagement"] < 25:
                    alerts.append("LOW ENGAGEMENT")
        else:
            alerts.append("NO FACE DETECTED")

    except Exception as e:
        # Surface errors as alerts instead of crashing — keeps camera feed alive
        print(f"[ERROR] Frame processing exception: {e}")
        import traceback; traceback.print_exc()
        alerts.append(f"ENGINE ERROR: {str(e)[:60]}")

    return {
        "scores":       scores,
        "calibrating":  not _is_calibrated,
        "calib_status": calib_status,
        "alerts":       alerts,
    }



@app.post("/session/audio")
async def session_audio(request: Request):
    """Receive raw float32 PCM audio from React (16kHz mono) and feed to engine."""
    if not _session_active or _engine is None:
        return {"ok": False}
    try:
        body = await request.body()
        if not body:
            return {"ok": False, "reason": "empty"}
        audio_np = np.frombuffer(body, dtype=np.float32).copy()
        _engine.analyze_audio(audio_np, sr=16000)
        return {"ok": True, "samples": len(audio_np)}
    except Exception as e:
        print(f"[WARN] Audio processing error: {e}")
        return {"ok": False, "reason": str(e)}


@app.post("/session/next-question")
def session_next_question():
    """Close current question silently and start tracking the next one."""
    global _recorder, _question_number, _question_reports

    if not _session_active or _recorder is None:
        raise HTTPException(status_code=400, detail="No active session.")

    with _lock:
        report = _recorder.stop()
        _question_reports.append(report)
        q = _question_number
        _question_number += 1
        _recorder = SessionRecorder()
        _recorder.start()

    ri = report["interview_readiness"]["score"]
    print(f"Q{q} closed — readiness {ri:.0f}%  |  Q{_question_number} started")
    return {"ok": True, "closed_question": q, "next_question": _question_number}


@app.post("/session/end")
def session_end():
    """Close final question, build full interview report, save to disk."""
    global _session_active, _recorder, _question_reports

    if not _session_active or _recorder is None:
        raise HTTPException(status_code=400, detail="No active session.")

    with _lock:
        final = _recorder.stop()
        _question_reports.append(final)
        _session_active = False

    print(f"Final Q closed — {len(_question_reports)} questions total. Building report…")

    interview = SessionRecorder.build_interview_report(_question_reports)
    SessionRecorder.print_interview_report(interview)
    SessionRecorder.save_interview_report_json(interview, path=REPORT_PATH)

    print(f"Interview report saved → {REPORT_PATH}")
    return {"ok": True, "total_questions": len(_question_reports)}


@app.get("/session/status")
def session_status():
    exists = os.path.exists(REPORT_PATH)
    mtime  = int(os.path.getmtime(REPORT_PATH) * 1000) if exists else None
    return {"ready": exists, "mtime": mtime}


@app.get("/session/report")
def session_report():
    if not os.path.exists(REPORT_PATH):
        raise HTTPException(status_code=404, detail="No report available yet.")
    with open(REPORT_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@app.post("/session/clear")
def session_clear():
    if os.path.exists(REPORT_PATH):
        os.remove(REPORT_PATH)
    return {"cleared": True}