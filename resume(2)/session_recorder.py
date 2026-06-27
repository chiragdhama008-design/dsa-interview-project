"""
session_recorder.py  —  Stage 8
---------------------------------
Tracks 4 dimensions:
    discomfort | confidence | confusion | engagement

Each R press (one question) creates a silent per-question report stored in
memory.  On Q (program exit), build_interview_report() combines all questions
into one full interview report with per-question breakdown + overall stats,
then prints and saves a single interview_report.json.

No mid-session output is printed or saved — everything comes at the end.
"""

import json
import os
import time
import numpy as np
from collections import defaultdict


EMOTION_LABELS = [
    "discomfort",
    "confidence",
    "confusion",
    "engagement",
]

THRESHOLDS = {
    "discomfort": [(0, 25, "Very Low"),   (25, 50, "Mild"),
                   (50, 70, "Moderate"),  (70, 100, "High")],
    "confidence": [(0, 30, "Low"),        (30, 55, "Moderate"),
                   (55, 75, "Good"),      (75, 100, "High")],
    "confusion":  [(0, 25, "Clear"),      (25, 50, "Occasional"),
                   (50, 70, "Frequent"),  (70, 100, "High")],
    "engagement": [(0, 30, "Low"),        (30, 55, "Moderate"),
                   (55, 75, "Good"),      (75, 100, "High")],
}


def _label(emotion: str, score: float) -> str:
    for lo, hi, label in THRESHOLDS[emotion]:
        if lo <= score < hi:
            return label
    return THRESHOLDS[emotion][-1][2]


class SessionRecorder:

    def __init__(self):
        self.start_time = None
        self.end_time   = None
        self.history    = defaultdict(list)
        self.timestamps = []

    def start(self):
        self.start_time = time.time()

    def record(self, scores: dict):
        if self.start_time is None:
            return
        self.timestamps.append(time.time())
        for k, v in scores.items():
            if k in EMOTION_LABELS:
                self.history[k].append(v)

    def stop(self) -> dict:
        self.end_time = time.time()
        return self._build_report()

    def _build_report(self) -> dict:
        duration = (self.end_time - self.start_time) if self.end_time else 0
        frames   = len(self.timestamps)

        stats = {}
        POSITIVE_DIMS = {"confidence", "engagement"}

        for em in EMOTION_LABELS:
            arr = np.array(self.history.get(em, [0]))
            avg = float(np.mean(arr))
            pk  = float(np.max(arr))
            fl  = float(np.min(arr))
            p90 = float(np.percentile(arr, 90))
            p10 = float(np.percentile(arr, 10))

            if em in POSITIVE_DIMS:
                weighted = round(avg * 0.60 + p10 * 0.40, 1)
            else:
                weighted = round(avg * 0.60 + p90 * 0.40, 1)

            stats[em] = {
                "average":  round(avg, 1),
                "peak":     round(pk,  1),
                "floor":    round(fl,  1),
                "weighted": weighted,
                "label":    _label(em, weighted),
            }

        # Stability — std-dev of discomfort over time
        discomfort_arr = np.array(self.history.get("discomfort", [0]))
        stability = round(
            float(100.0 - np.clip(np.std(discomfort_arr), 0, 50) * 2), 1)

        # Interview readiness
        readiness = round(
            stats["confidence"]["weighted"]             * 0.35 +
            stats["engagement"]["weighted"]             * 0.30 +
            (100 - stats["discomfort"]["weighted"])     * 0.25 +
            (100 - stats["confusion"]["weighted"])      * 0.10,
            1,
        )
        readiness = float(np.clip(readiness, 0, 100))

        if readiness >= 75:   readiness_label = "Strong"
        elif readiness >= 55: readiness_label = "Adequate"
        elif readiness >= 35: readiness_label = "Needs Work"
        else:                 readiness_label = "Struggling"

        # --- Session timeline ------------------------------------------------
        # Build a list of per-frame snapshots with relative timestamps so the
        # front-end can plot "discomfort spiked at 2:15" style coaching notes.
        timeline = []
        t0 = self.start_time or 0.0
        for i, ts in enumerate(self.timestamps):
            entry = {"t": round(ts - t0, 2)}
            for em in EMOTION_LABELS:
                history = self.history.get(em, [])
                if i < len(history):
                    entry[em] = round(history[i], 1)
            timeline.append(entry)
        # ---------------------------------------------------------------------

        return {
            "duration_seconds":    round(duration, 1),
            "frames_recorded":     frames,
            "emotions":            stats,
            "stability_score":     stability,
            "interview_readiness": {
                "score": readiness,
                "label": readiness_label,
            },
            "timeline":            timeline,
        }

    @staticmethod
    def print_report(report: dict):
        sep  = "═" * 60
        sep2 = "─" * 60

        print(f"\n{sep}")
        print("   AI INTERVIEW ROOM  —  SESSION REPORT")
        print(sep)

        dur  = report["duration_seconds"]
        m, s = divmod(int(dur), 60)
        print(f"  Duration   : {m}m {s}s  ({report['frames_recorded']} frames analysed)")
        print(sep2)

        print("\n  EMOTION BREAKDOWN\n")
        print(f"  {'Dimension':<20} {'Avg':>6}  {'Wtd':>6}  {'Peak':>6}  {'Label'}")
        print(f"  {'─'*20}  {'─'*5}  {'─'*5}  {'─'*5}  {'─'*14}")

        for em in EMOTION_LABELS:
            e = report["emotions"][em]
            print(f"  {em.replace('_', ' ').title():<20} "
                  f"{e['average']:>5.1f}%  "
                  f"{e['weighted']:>5.1f}%  "
                  f"{e['peak']:>5.1f}%  "
                  f"{e['label']}")

        print(f"\n  Avg = flat average | Wtd = peak/floor-weighted (used for label)")

        print(f"\n{sep2}")
        print(f"  Emotional stability : {report['stability_score']}%")

        ri = report["interview_readiness"]
        print(f"\n  INTERVIEW READINESS : {ri['score']:.1f} / 100  [{ri['label'].upper()}]")
        print(f"\n{sep}")

        print("\n  QUALITATIVE SUMMARY\n")
        for em in EMOTION_LABELS:
            e     = report["emotions"][em]
            avg   = e["weighted"]
            label = e["label"]
            name  = em.replace("_", " ").title()

            if em == "discomfort":
                if avg < 30:   msg = "Candidate appeared at ease throughout."
                elif avg < 55: msg = "Manageable discomfort — normal for an interview setting."
                else:          msg = "Visibly uncomfortable for much of the session."

            elif em == "confidence":
                if avg >= 65:  msg = "Demonstrated strong, consistent confidence."
                elif avg >= 45: msg = "Moderately confident with some wavering moments."
                else:          msg = "Struggled to project confidence — gaze and voice inconsistent."

            elif em == "confusion":
                if avg < 30:   msg = "Followed topics clearly — minimal confusion signals."
                elif avg < 55: msg = "Occasional confusion — some head tilts and brow raises."
                else:          msg = "Frequent confusion indicators — may benefit from clearer questions."

            elif em == "engagement":
                if avg >= 65:  msg = "Highly engaged — nodding, open eyes, forward lean observed."
                elif avg >= 40: msg = "Moderately engaged throughout."
                else:          msg = "Low engagement — limited responsiveness in posture and gaze."

            else:
                msg = ""

            print(f"  {name:<22}: [{label}]  {msg}")

        print(f"\n{sep}\n")

    @staticmethod
    def save_report_json(report: dict, path: str = "report.json"):
        """
        Write the report dict to a JSON file next to index.html.
        Adds human-readable verdict strings so the HTML page doesn't
        need to re-implement the threshold logic.
        """
        verdicts = {}
        for em in EMOTION_LABELS:
            e   = report["emotions"][em]
            avg = e["weighted"]

            if em == "discomfort":
                if avg < 30:   msg = "Candidate appeared at ease throughout."
                elif avg < 55: msg = "Manageable discomfort — normal for an interview setting."
                else:          msg = "Visibly uncomfortable for much of the session."

            elif em == "confidence":
                if avg >= 65:  msg = "Demonstrated strong, consistent confidence."
                elif avg >= 45: msg = "Moderately confident with some wavering moments."
                else:          msg = "Struggled to project confidence — gaze and voice inconsistent."

            elif em == "confusion":
                if avg < 30:   msg = "Followed topics clearly — minimal confusion signals."
                elif avg < 55: msg = "Occasional confusion — some head tilts and brow raises."
                else:          msg = "Frequent confusion indicators — may benefit from clearer questions."

            elif em == "engagement":
                if avg >= 65:  msg = "Highly engaged — nodding, open eyes, forward lean observed."
                elif avg >= 40: msg = "Moderately engaged throughout."
                else:          msg = "Low engagement — limited responsiveness in posture and gaze."

            else:
                msg = ""

            verdicts[em] = msg

        output = {**report, "verdicts": verdicts}

        with open(path, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2)

        abs_path = os.path.abspath(path)
        print(f"  Report saved → {abs_path}")

    @staticmethod
    def build_interview_report(question_reports: list) -> dict:
        """
        Combine a list of per-question reports (each from _build_report()) into
        one full interview report with per-question breakdown and overall stats.

        question_reports — list of dicts, one per R-press (one per question).
        """
        import numpy as _np

        n = len(question_reports)
        if n == 0:
            return {}

        # ── Per-question summary rows ─────────────────────────────────────
        questions = []
        for i, r in enumerate(question_reports, 1):
            dur = r["duration_seconds"]
            m, s = divmod(int(dur), 60)
            q = {
                "question_number": i,
                "duration":        f"{m}m {s}s",
                "duration_seconds": dur,
                "readiness":       r["interview_readiness"],
                "stability":       r["stability_score"],
                "emotions":        {
                    em: {
                        "weighted": r["emotions"][em]["weighted"],
                        "label":    r["emotions"][em]["label"],
                        "peak":     r["emotions"][em]["peak"],
                    }
                    for em in EMOTION_LABELS
                },
                # Worst moment: t and value of peak discomfort in timeline
                "peak_discomfort_t": _peak_moment(r.get("timeline", []), "discomfort"),
            }
            questions.append(q)

        # ── Overall stats across all questions ────────────────────────────
        overall_emotions = {}
        for em in EMOTION_LABELS:
            vals = [r["emotions"][em]["weighted"] for r in question_reports]
            overall_emotions[em] = {
                "average": round(float(_np.mean(vals)), 1),
                "best":    round(float(_np.min(vals) if em in {"discomfort","confusion"} else _np.max(vals)), 1),
                "worst":   round(float(_np.max(vals) if em in {"discomfort","confusion"} else _np.min(vals)), 1),
                "trend":   _trend(vals),
            }

        readiness_scores = [r["interview_readiness"]["score"] for r in question_reports]
        overall_readiness = {
            "average": round(float(_np.mean(readiness_scores)), 1),
            "best_q":  int(_np.argmax(readiness_scores)) + 1,
            "worst_q": int(_np.argmin(readiness_scores)) + 1,
            "trend":   _trend(readiness_scores),
            "label":   _readiness_label(float(_np.mean(readiness_scores))),
        }

        total_duration = sum(r["duration_seconds"] for r in question_reports)
        tm, ts = divmod(int(total_duration), 60)

        return {
            "total_questions":   n,
            "total_duration":    f"{tm}m {ts}s",
            "questions":         questions,
            "overall_emotions":  overall_emotions,
            "overall_readiness": overall_readiness,
        }

    @staticmethod
    def print_interview_report(report: dict):
        if not report:
            print("  No questions recorded.")
            return

        sep  = "═" * 65
        sep2 = "─" * 65

        print(f"\n{sep}")
        print("   AI INTERVIEW ROOM  —  FULL INTERVIEW REPORT")
        print(sep)
        print(f"  Questions : {report['total_questions']}   "
              f"Total time : {report['total_duration']}")
        print(sep2)

        # Per-question table
        print("\n  PER-QUESTION BREAKDOWN\n")
        hdr = f"  {'Q':>2}  {'Duration':>8}  {'Readiness':>10}  {'Discomfort':>11}  {'Confidence':>11}  {'Confusion':>10}  {'Engagement':>11}"
        print(hdr)
        print(f"  {'─'*2}  {'─'*8}  {'─'*10}  {'─'*11}  {'─'*11}  {'─'*10}  {'─'*11}")

        for q in report["questions"]:
            ri    = q["readiness"]["score"]
            em    = q["emotions"]
            worst = q["peak_discomfort_t"]
            print(f"  {q['question_number']:>2}  {q['duration']:>8}  "
                  f"{ri:>8.1f}%   "
                  f"{em['discomfort']['weighted']:>8.1f}%   "
                  f"{em['confidence']['weighted']:>8.1f}%   "
                  f"{em['confusion']['weighted']:>7.1f}%   "
                  f"{em['engagement']['weighted']:>8.1f}%")
            if worst:
                mt, mv = worst
                mm, ms = divmod(int(mt), 60)
                print(f"      ↳ peak discomfort {mv:.0f}% at {mm}:{ms:02d}")

        print(f"\n{sep2}")

        # Overall emotion trends
        print("\n  OVERALL EMOTION TRENDS\n")
        oe = report["overall_emotions"]
        for em in EMOTION_LABELS:
            e = oe[em]
            print(f"  {em.replace('_',' ').title():<22} "
                  f"avg={e['average']:>5.1f}%  "
                  f"best={e['best']:>5.1f}%  "
                  f"worst={e['worst']:>5.1f}%  "
                  f"trend={e['trend']}")

        print(f"\n{sep2}")

        # Overall readiness
        ori = report["overall_readiness"]
        print(f"\n  OVERALL INTERVIEW READINESS : {ori['average']:.1f} / 100"
              f"  [{ori['label'].upper()}]")
        print(f"  Best question  : Q{ori['best_q']}   "
              f"Worst question : Q{ori['worst_q']}   "
              f"Trend : {ori['trend']}")

        print(f"\n{sep2}")
        print("\n  COACHING NOTES\n")

        # Generate coaching notes from worst dimensions
        oe = report["overall_emotions"]
        if oe["discomfort"]["average"] >= 55:
            print("  [!] High discomfort sustained across the interview.")
            print("      Practice relaxation techniques before sessions.")
        if oe["confidence"]["average"] < 45:
            print("  [!] Confidence was consistently low.")
            print("      Work on sustained eye contact and reducing head jitter.")
        if oe["confusion"]["average"] >= 40:
            print("  [~] Frequent confusion signals — review question preparation.")
        if oe["engagement"]["average"] < 40:
            print("  [~] Low engagement throughout — try nodding and forward lean.")

        # Flag worst question
        wq = ori["worst_q"]
        wq_data = report["questions"][wq - 1]
        print(f"\n  Toughest question was Q{wq} "
              f"(readiness {wq_data['readiness']['score']:.0f}%) — "
              f"discomfort peaked at {wq_data['emotions']['discomfort']['peak']:.0f}%.")

        if ori["trend"] in ("↑ improving", "→ stable"):
            print("  ✔  Positive trend — performance improved as interview progressed.")
        else:
            print("  ⚠  Declining trend — fatigue or increasing difficulty detected.")

        print(f"\n{sep}\n")

    @staticmethod
    def save_interview_report_json(report: dict, path: str = "interview_report.json"):
        import json as _json, os as _os
        with open(path, "w", encoding="utf-8") as f:
            _json.dump(report, f, indent=2)
        print(f"  Interview report saved → {_os.path.abspath(path)}")


# ─────────────────────────────────────────────────────────────────────────────
# Module-level helpers for interview report
# ─────────────────────────────────────────────────────────────────────────────
def _peak_moment(timeline: list, emotion: str):
    """Return (t, value) of the highest score for `emotion` in timeline, or None."""
    if not timeline:
        return None
    best = max(timeline, key=lambda e: e.get(emotion, 0))
    return (best["t"], best.get(emotion, 0))

def _trend(values: list) -> str:
    """Simple linear trend over a list of scalars."""
    import numpy as _np
    if len(values) < 2:
        return "→ stable"
    x = _np.arange(len(values), dtype=float)
    slope = float(_np.polyfit(x, values, 1)[0])
    if slope > 2:   return "↑ improving"
    if slope < -2:  return "↓ declining"
    return "→ stable"

def _readiness_label(score: float) -> str:
    if score >= 75:   return "Strong"
    if score >= 55:   return "Adequate"
    if score >= 35:   return "Needs Work"
    return "Struggling"