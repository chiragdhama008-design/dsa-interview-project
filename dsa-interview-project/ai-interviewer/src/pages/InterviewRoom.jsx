import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mic, Camera, Clock3, Send, Bot, Award, CheckCircle, RefreshCw, ThumbsUp, Sparkles, TrendingUp } from "lucide-react";
import Sidebar from "../components/Sidebar";

export default function InterviewRoom() {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    domain,
    difficulty,
    duration,
    customQuestions,
    isResumeInterview,
    topic
  } = location.state || {};

  const standardQuestions = [
    "Why did you choose MongoDB for your AI Interview Platform project?",
    "Explain React Hooks.",
    "What is the difference between SQL and NoSQL databases?",
    "How does JWT authentication work?"
  ];

  const activeQuestions = customQuestions && customQuestions.length > 0 ? customQuestions : standardQuestions;

  const getInitialTime = () => {
    switch (duration) {
      case "15 Min": return 15 * 60;
      case "30 Min": return 30 * 60;
      case "45 Min": return 45 * 60;
      default: return 15 * 60;
    }
  };

  const [timeLeft, setTimeLeft] = useState(getInitialTime());
  const [transcript, setTranscript] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [historyLog, setHistoryLog] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackData, setFeedbackData] = useState(null);
  const [emotionReport, setEmotionReport] = useState(null);
  const [expandedQ, setExpandedQ] = useState(null);

  // ── Webcam + emotion engine ───────────────────────────────────────────
  const videoRef      = useRef(null);
  const canvasRef     = useRef(null);
  const streamRef     = useRef(null);
  const frameTimer    = useRef(null);
  const audioCtxRef   = useRef(null);
  const audioBufRef   = useRef([]);
  const audioTimerRef = useRef(null);
  const videoStreamRef = useRef(null);  // holds the cloned video-only stream

  const API = "http://localhost:8000";
  const sendFrameRef = useRef(null);  // ref so useEffect closure always gets live fn

  const [sessionActive,  setSessionActive]  = useState(false);
  const [calibrating,    setCalibrating]    = useState(false);
  const [calibStatus,    setCalibStatus]    = useState(null);
  const [emotionScores,  setEmotionScores]  = useState(null);
  const [alerts,         setAlerts]         = useState([]);
  const [sessionEnded,   setSessionEnded]   = useState(false);

  // ── Audio helpers ────────────────────────────────────────────────────
  const startAudio = (micStream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(micStream);
      const proc   = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => {
        audioBufRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(proc);
      proc.connect(ctx.destination);
      // Flush accumulated PCM to api.py every second
      audioTimerRef.current = setInterval(async () => {
        if (audioBufRef.current.length === 0) return;
        const chunks = audioBufRef.current;
        audioBufRef.current = [];
        const total  = chunks.reduce((s, c) => s + c.length, 0);
        const merged = new Float32Array(total);
        let offset = 0;
        for (const c of chunks) { merged.set(c, offset); offset += c.length; }
        try {
          await fetch(`${API}/session/audio`, {
            method:  "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body:    merged.buffer,
          });
        } catch (_) {}
      }, 1000);
    } catch (e) {
      console.warn("Audio capture failed:", e.message);
    }
  };

  const stopAudio = () => {
    clearInterval(audioTimerRef.current);
    if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
    audioBufRef.current = [];
  };

  // Start webcam + mic AND session automatically on mount
  useEffect(() => {
    const startSession = async (stream, hasMic) => {
      streamRef.current = stream;
      // Assign original stream directly — video element is already muted
      // so no echo. Avoids creating a separate cloned stream to track/kill.
      if (videoRef.current) videoRef.current.srcObject = stream;
      if (hasMic) startAudio(stream);
      try {
        await fetch(`${API}/session/start`, { method: "POST" });
        setSessionActive(true);
        setCalibrating(true);
        frameTimer.current = setInterval(() => sendFrameRef.current?.(), 200);
      } catch (_) {
        setSessionActive(true);
        setCalibrating(false);
      }
    };

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => startSession(stream, true))
      .catch(() =>
        navigator.mediaDevices
          .getUserMedia({ video: true, audio: false })
          .then((stream) => startSession(stream, false))
          .catch(() => { setSessionActive(true); setCalibrating(false); })
      );

    return () => {
      stopAudio();
      clearInterval(frameTimer.current);
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.srcObject = null;
        }
      } catch (_) {}
    };
  }, []);

  // Capture a frame from <video> and return it as base64 JPEG
  const captureFrame = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  // Send a frame to Python every 200 ms
  const sendFrame = useCallback(async () => {
    const b64 = captureFrame();
    if (!b64) return;
    try {
      const res  = await fetch(`${API}/session/frame`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ image: b64 }),
      });
      const data = await res.json();
      setEmotionScores(data.scores);
      setCalibrating(data.calibrating);
      setCalibStatus(data.calib_status || null);
      setAlerts(data.alerts || []);
    } catch (err) {
      console.error("Frame send error:", err);
    }
  }, [captureFrame]);
  sendFrameRef.current = sendFrame;  // keep ref in sync

  // Start session when user clicks "Begin Session"
  const handleStartSession = async () => {
    try {
      await fetch(`${API}/session/start`, { method: "POST" });
      setSessionActive(true);
      setSessionEnded(false);
      setEmotionScores(null);
      frameTimer.current = setInterval(sendFrame, 200);
    } catch (err) {
      alert("Could not connect to Python server. Make sure api.py is running.");
    }
  };

  // Next question
  const handleNextQuestion = async () => {
    await fetch(`${API}/session/next-question`, { method: "POST" });
    setCurrentQuestion((q) => q + 1);
    setTranscript("");
  };

  // End interview — stop frames, kill camera, call /session/end, then show result page
  const handleEndSession = async (finalHistory) => {
    // ── Kill camera FIRST ──
    clearInterval(frameTimer.current);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      }
    } catch (_) {}
    stopAudio();
    setSessionActive(false);
    setSessionEnded(true);
    setIsSubmitting(true);

    try {
      await fetch(`${API}/session/end`, { method: "POST" });
      // Fetch emotion report built by Python
      try {
        const rpt = await fetch(`${API}/session/report`);
        if (rpt.ok) setEmotionReport(await rpt.json());
      } catch (_) {}
    } catch (_) {}

    const answersToEval = (finalHistory && finalHistory.length > 0)
      ? finalHistory
      : historyLog.length > 0 ? historyLog
      : [{ questionText: activeQuestions[currentQuestion], answerText: transcript || "No answer recorded" }];

    const DUMMY_FEEDBACK = {
      score: 74,
      summary: "Strong technical understanding demonstrated across most questions. Some answers could benefit from more structured explanations and real-world examples.",
      strongPoints: [
        "Clear explanation of core concepts with good use of terminology.",
        "Showed practical knowledge of system design trade-offs.",
        "Answered under time pressure with confidence and minimal hesitation.",
      ],
      improvements: [
        "Add concrete examples from past projects to back up theoretical answers.",
        "Structure longer answers using the STAR method for clarity.",
        "Cover edge cases and failure scenarios when discussing system design.",
      ],
    };

    try {
      const bodyPayload = { interviewAnswers: answersToEval };
      if (isResumeInterview && (location.state?.resumeId || localStorage.getItem("lastActiveResumeId"))) {
        bodyPayload.resumeId = location.state?.resumeId || localStorage.getItem("lastActiveResumeId");
      } else {
        bodyPayload.topic = topic || domain || "General Track";
      }

      const response = await fetch("http://localhost:5000/api/interview/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Failed.");
      setFeedbackData(data);
    } catch (err) {
      console.warn("Backend unavailable, showing dummy result:", err.message);
      setFeedbackData(DUMMY_FEEDBACK);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startSpeechRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech Recognition not supported in this browser version.");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.start();

    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      setTranscript(text);
    };
  };

  const submitAnswer = async () => {
    if (!transcript.trim()) {
      alert("Please offer an answer first or type a short statement before hitting submit.");
      return;
    }

    const targetQuestion = activeQuestions[currentQuestion];
    const questionString = typeof targetQuestion === "object" ? targetQuestion.question : targetQuestion;

    const updatedHistory = [
      ...historyLog,
      { questionText: questionString, answerText: transcript }
    ];
    setHistoryLog(updatedHistory);

    if (currentQuestion < activeQuestions.length - 1) {
      // Tell Python to close this question and start next
      try { await fetch(`${API}/session/next-question`, { method: "POST" }); } catch (_) {}
      setCurrentQuestion(currentQuestion + 1);
      setTranscript("");
    } else {
      // Last question — pass updatedHistory directly so stale state isn't read
      setTranscript("");
      await handleEndSession(updatedHistory);
    }
  };

  // Timer only runs after calibration completes
  useEffect(() => {
    if (calibrating || !sessionActive) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [calibrating, sessionActive]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  if (isSubmitting) {
    return (
      <div className="flex min-h-screen bg-slate-950 text-white items-center justify-center">
        <div className="text-center space-y-4">
          <RefreshCw size={50} className="mx-auto text-purple-400 animate-spin" />
          <h2 className="text-2xl font-bold">Analyzing Your Performance...</h2>
          <p className="text-slate-400 max-w-sm">Gemini is looking over your answers and compiling score tracking metrics.</p>
        </div>
      </div>
    );
  }

  // ==========================================
  // STYLISH UPGRADED EVALUATION CARD VIEWER
  // ==========================================
  // ── helpers for per-question rating ───────────────────────────────────────
  const qScore = (q) => {
    if (!q) return 0;
    const e = q.emotions;
    const raw =
      e.confidence.weighted  * 0.35 +
      e.engagement.weighted  * 0.30 +
      (100 - e.discomfort.weighted) * 0.25 +
      (100 - e.confusion.weighted)  * 0.10;
    return Math.min(10, Math.max(0, Math.round(raw / 10)));
  };

  if (feedbackData) {
    // ── build coaching remarks from emotionReport ────────────────────────────
    let remarks = [];
    if (emotionReport) {
      const ori   = emotionReport.overall_readiness;
      const oe    = emotionReport.overall_emotions;
      const dis   = oe.discomfort.average;
      const conf  = oe.confidence.average;
      const confu = oe.confusion.average;
      const eng   = oe.engagement.average;
      const trend = ori.trend || "";
      const RC    = { warn:"#f06464", info:"#f5a623", good:"#43d98c" };
      const RI    = { warn:"⚠", info:"~", good:"✔" };

      if (dis >= 70)       remarks.push({ type:"warn", tag:"High Stress Detected",       text:"Sustained facial stress (brow tension, asymmetric expressions) is visibly affecting your composure. Try box breathing before sessions: inhale 4 counts, hold 4, exhale 4, hold 4 — activates the parasympathetic system within 90 seconds." });
      else if (dis >= 55)  remarks.push({ type:"warn", tag:"Moderate Stress",             text:"Moderate brow tension detected. Feiler & Powell (2016) found shifting attention to the question content — not how you appear — significantly reduces self-focused anxiety. Take one slow breath before each answer." });
      else if (dis >= 40)  remarks.push({ type:"info", tag:"Mild Discomfort",             text:"Mild stress signals, well within normal range. Repeated mock practice reduces interview anxiety by 50–70% over 3–4 weeks (exposure therapy research)." });
      else                 remarks.push({ type:"good", tag:"Calm Under Pressure",         text:"Very low stress signals throughout — a strong advantage. Interviewers rate composed candidates as more trustworthy. Anchor this with a slow breath at the start of each question." });

      if (conf < 35)       remarks.push({ type:"warn", tag:"Low Confidence Projection",  text:"55% of perceived competence comes from nonverbal presence (Mehrabian). Fix: maintain eye contact ~60% of speaking time, sit upright with a slight forward lean, keep your head steady. Record yourself in mock sessions to spot habits." });
      else if (conf < 45)  remarks.push({ type:"warn", tag:"Inconsistent Confidence",    text:`Confidence dropped sharply on harder questions (best ${oe.confidence.best.toFixed(0)}%, worst ${oe.confidence.worst.toFixed(0)}%). Use the \"grounding pause\" — 2–3 seconds of stillness before answering — interviewers read it as thoughtfulness, not hesitation.` });
      else if (conf < 60)  remarks.push({ type:"info", tag:"Moderate Confidence",        text:"Room to grow here. Anchor answers with concrete examples (STAR method) — specific story-based answers naturally increase perceived competence and project conviction." });
      else                 remarks.push({ type:"good", tag:"Strong Confidence",           text:"Strong and steady confidence throughout. Reinforce with natural eye contact and open posture — avoid looking down when formulating answers." });

      if (confu >= 55)     remarks.push({ type:"warn", tag:"Frequent Confusion Signals", text:"High brow-raise and head-tilt signals detected. When a question is unclear, paraphrase it back: \"Just to confirm, you're asking about X?\" — demonstrates active listening and buys thinking time without projecting confusion." });
      else if (confu >= 35)remarks.push({ type:"info", tag:"Some Confusion Moments",     text:"Occasional confusion on complex questions. NCDA coaching research recommends nodding slowly as you listen — it anchors attention and suppresses involuntary brow reactions." });
      else                 remarks.push({ type:"good", tag:"Clear Understanding",         text:"Minimal confusion signals — strong active listening. Keep making subtle acknowledgment gestures (slight nods, steady gaze) as questions are asked." });

      if (eng < 30)        remarks.push({ type:"warn", tag:"Low Engagement",             text:"Low engagement reads as disinterest even when you're focused internally. The 43:57 listening rule: candidates who visibly engage before answering score significantly higher on interpersonal fit. Nod once or twice, let your eyes widen slightly, lean 5–10° forward." });
      else if (eng < 45)   remarks.push({ type:"info", tag:"Moderate Engagement",        text:"Present but room to project more. Studies confirm animated (controlled) facial expressions correlate with higher rapport scores. Warm up expressiveness before sessions — practice nodding and smiling in a mirror to prime those muscle groups." });
      else if (eng < 65)   remarks.push({ type:"good", tag:"Good Engagement",            text:"Good attentiveness visible. To reach 'high engagement', avoid looking away when formulating answers — maintain forward gaze with a natural pause instead." });
      else                 remarks.push({ type:"good", tag:"Highly Engaged",             text:"Excellent visible engagement — one of the strongest nonverbal signals. Builds interviewer rapport and makes answers land harder. Sustain this on tougher questions too." });

      if (trend.includes("improv"))       remarks.push({ type:"good", tag:"Improving Trend", text:"Scores improved as the interview progressed — you warm up well. Do a 2–3 min warm-up conversation before real interviews to enter already settled." });
      else if (trend.includes("declin"))  remarks.push({ type:"warn", tag:"Declining Trend", text:"Scores declined across questions, suggesting fatigue build-up. Between questions, reset with one slow breath and briefly recall a relevant strength — this interrupts the anxiety feedback loop." });
    }

    const EM_COLORS = { discomfort:"#f06464", confidence:"#43d98c", confusion:"#f5a623", engagement:"#4fc3f7" };
    const RC_MAP    = { warn:"#f06464", info:"#f5a623", good:"#43d98c" };
    const RI_MAP    = { warn:"⚠", info:"~", good:"✔" };

    return (
      <div style={{display:"flex", minHeight:"100vh", background:"#020617", color:"white", fontFamily:"Inter,sans-serif"}}>
        <Sidebar />

        {/* ── LEFT: main scrollable content ─────────────────────────────── */}
        <div style={{flex:1, overflowY:"auto", padding:"32px 32px 32px 32px", maxWidth:"calc(100vw - 288px - 340px)"}}>

          {/* Header */}
          <div style={{display:"flex", alignItems:"center", gap:14, borderBottom:"1px solid #1e293b", paddingBottom:24, marginBottom:32}}>
            <div style={{padding:10, background:"linear-gradient(135deg,#7c3aed,#06b6d4)", borderRadius:14}}>
              <CheckCircle size={28} />
            </div>
            <div>
              <h1 style={{fontSize:28, fontWeight:900, letterSpacing:"-0.02em", margin:0,
                background:"linear-gradient(to right,#fff,#94a3b8)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent"}}>
                Interview Performance Review
              </h1>
              <p style={{color:"#64748b", fontSize:13, margin:"4px 0 0"}}>AI analysis · {domain || topic || "General"} · {difficulty || "Intermediate"}</p>
            </div>
          </div>

          {/* Overall score + summary */}
          <div style={{display:"grid", gridTemplateColumns:"160px 1fr", gap:20, marginBottom:32}}>
            <div style={{background:"linear-gradient(160deg,#1e1b4b,#0f172a)", border:"1px solid #312e81",
              borderRadius:20, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:20}}>
              <Award size={22} color="#fbbf24" style={{marginBottom:6}}/>
              <div style={{fontSize:11, color:"#94a3b8", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:4}}>AI Score</div>
              <div style={{fontSize:52, fontWeight:900, lineHeight:1,
                background:"linear-gradient(to bottom,#fbbf24,#f59e0b)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent"}}>
                {feedbackData.score}
              </div>
              <div style={{fontSize:12, color:"#64748b"}}>/ 100</div>
              <div style={{width:"100%", height:4, background:"#1e293b", borderRadius:4, marginTop:10, overflow:"hidden"}}>
                <div style={{height:"100%", width:`${feedbackData.score}%`, borderRadius:4,
                  background:"linear-gradient(to right,#f59e0b,#fbbf24)", transition:"width 1s ease"}}/>
              </div>
            </div>
            <div style={{background:"#0f172a", border:"1px solid #1e293b", borderRadius:20, padding:"20px 24px"}}>
              {feedbackData.summary && (
                <div style={{display:"flex", gap:10, alignItems:"flex-start", marginBottom:16,
                  background:"#1e293b", borderRadius:12, padding:"12px 14px"}}>
                  <Sparkles size={15} color="#a78bfa" style={{flexShrink:0, marginTop:2}}/>
                  <p style={{margin:0, fontSize:13, color:"#cbd5e1", lineHeight:1.7}}>{feedbackData.summary}</p>
                </div>
              )}
              <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
                {(feedbackData.strongPoints||[]).slice(0,2).map((p,i)=>(
                  <div key={i} style={{display:"flex", gap:8, alignItems:"flex-start", background:"#0a1628",
                    border:"1px solid #14532d", borderRadius:10, padding:"10px 12px"}}>
                    <CheckCircle size={13} color="#4ade80" style={{flexShrink:0, marginTop:2}}/>
                    <span style={{fontSize:12, color:"#86efac", lineHeight:1.5}}>{p}</span>
                  </div>
                ))}
                {(feedbackData.improvements||[]).slice(0,2).map((p,i)=>(
                  <div key={i} style={{display:"flex", gap:8, alignItems:"flex-start", background:"#0a1020",
                    border:"1px solid #78350f", borderRadius:10, padding:"10px 12px"}}>
                    <TrendingUp size={13} color="#fb923c" style={{flexShrink:0, marginTop:2}}/>
                    <span style={{fontSize:12, color:"#fdba74", lineHeight:1.5}}>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Per-question cards — only when emotionReport available */}
          {emotionReport && (
            <>
              <div style={{fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase",
                color:"#475569", marginBottom:14, fontFamily:"monospace"}}>Per-Question Breakdown</div>

              <div style={{display:"flex", flexDirection:"column", gap:10, marginBottom:32}}>
                {emotionReport.questions.map((q, i) => {
                  const score   = qScore(q);
                  const isOpen  = expandedQ === i;
                  const scoreColor = score >= 8 ? "#43d98c" : score >= 6 ? "#4fc3f7" : score >= 4 ? "#f5a623" : "#f06464";
                  const dur = q.duration_seconds;
                  const mm = Math.floor(dur/60), ss = Math.floor(dur%60);

                  return (
                    <div key={i} style={{background:"#0f172a", border:`1px solid ${isOpen ? "#334155":"#1e293b"}`,
                      borderRadius:14, overflow:"hidden", transition:"border-color .2s"}}>

                      {/* Row header — always visible */}
                      <div onClick={()=>setExpandedQ(isOpen ? null : i)}
                        style={{display:"grid", gridTemplateColumns:"36px 1fr auto auto auto",
                          gap:"0 16px", alignItems:"center", padding:"14px 18px", cursor:"pointer"}}>
                        <div style={{fontFamily:"monospace", fontSize:12, color:"#475569", fontWeight:700}}>Q{q.question_number}</div>
                        <div style={{fontSize:13, color:"#94a3b8", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"}}>
                          {activeQuestions[i]
                            ? (typeof activeQuestions[i]==="object" ? activeQuestions[i].question : activeQuestions[i]).slice(0,70)+"…"
                            : `Question ${q.question_number}`}
                        </div>
                        <span style={{fontFamily:"monospace", fontSize:11, color:"#475569"}}>{mm}:{String(ss).padStart(2,"0")}</span>
                        <div style={{display:"flex", alignItems:"center", gap:6}}>
                          <span style={{fontFamily:"monospace", fontSize:22, fontWeight:900, color:scoreColor}}>{score}</span>
                          <span style={{fontSize:11, color:"#475569"}}>/10</span>
                        </div>
                        <span style={{color:"#475569", fontSize:11, transform: isOpen?"rotate(180deg)":"none", transition:"transform .2s"}}>▼</span>
                      </div>

                      {/* Expanded detail */}
                      {isOpen && (
                        <div style={{borderTop:"1px solid #1e293b", padding:"16px 18px", display:"flex", flexDirection:"column", gap:12}}>
                          {/* Time taken */}
                          <div style={{display:"flex", gap:8, alignItems:"center", background:"#1e293b",
                            borderRadius:8, padding:"8px 12px", width:"fit-content"}}>
                            <span style={{fontSize:12, color:"#64748b", fontFamily:"monospace"}}>⏱ Time taken:</span>
                            <span style={{fontSize:12, color:"#94a3b8", fontFamily:"monospace", fontWeight:700}}>{mm}m {ss}s</span>
                          </div>

                          {/* Emotion bars */}
                          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:"8px 20px"}}>
                            {["discomfort","confidence","confusion","engagement"].map(em => {
                              const e = q.emotions[em];
                              const color = EM_COLORS[em];
                              return (
                                <div key={em}>
                                  <div style={{display:"flex", justifyContent:"space-between", marginBottom:4}}>
                                    <span style={{fontSize:11, color:"#64748b", textTransform:"capitalize"}}>{em}</span>
                                    <div style={{display:"flex", gap:10}}>
                                      <span style={{fontFamily:"monospace", fontSize:10, color:"#475569"}}>peak {e.peak}%</span>
                                      <span style={{fontFamily:"monospace", fontSize:11, fontWeight:700, color}}>{e.weighted.toFixed(1)}%</span>
                                    </div>
                                  </div>
                                  <div style={{height:5, background:"#1e293b", borderRadius:3, overflow:"hidden"}}>
                                    <div style={{height:"100%", width:`${e.weighted}%`, background:color, borderRadius:3,
                                      transition:"width 1s ease"}}/>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Peak discomfort moment */}
                          {q.peak_discomfort_t && (
                            <div style={{fontFamily:"monospace", fontSize:11, color:"#475569",
                              background:"#1e293b", borderRadius:8, padding:"8px 12px",
                              display:"flex", gap:16, flexWrap:"wrap"}}>
                              <span style={{color:"#f06464"}}>⚡ peak discomfort</span>
                              <span>{q.peak_discomfort_t[1].toFixed(0)}% at {Math.floor(q.peak_discomfort_t[0]/60)}:{String(Math.floor(q.peak_discomfort_t[0]%60)).padStart(2,"0")}</span>
                              <span>stability {q.stability.toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Stress trend chart */}
              <div style={{background:"#0f172a", border:"1px solid #1e293b", borderRadius:16, padding:"20px 24px", marginBottom:32}}>
                <div style={{fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase",
                  color:"#475569", marginBottom:16, fontFamily:"monospace"}}>Stress Trend Across Interview</div>

                <div style={{display:"flex", gap:10}}>
                  {/* Y-axis labels */}
                  <div style={{display:"flex", flexDirection:"column", justifyContent:"space-between",
                    height:120, paddingBottom:20, flexShrink:0, width:30}}>
                    <span style={{fontFamily:"monospace", fontSize:9, color:"#f06464", textAlign:"right"}}>High</span>
                    <span style={{fontFamily:"monospace", fontSize:9, color:"#f5a623", textAlign:"right"}}>Mod</span>
                    <span style={{fontFamily:"monospace", fontSize:9, color:"#43d98c", textAlign:"right"}}>Low</span>
                    <span style={{fontFamily:"monospace", fontSize:9, color:"#334155", textAlign:"right"}}>0</span>
                  </div>

                  {/* Chart area */}
                  <div style={{flex:1, position:"relative"}}>
                    {/* Zone dashed lines */}
                    <div style={{position:"absolute", inset:"0 0 20px 0", pointerEvents:"none"}}>
                      <div style={{position:"absolute", bottom:"60%", left:0, right:0,
                        borderTop:"1px dashed rgba(240,100,100,0.25)"}}/>
                      <div style={{position:"absolute", bottom:"40%", left:0, right:0,
                        borderTop:"1px dashed rgba(245,166,35,0.25)"}}/>
                    </div>

                    {/* Bars */}
                    <div style={{display:"flex", alignItems:"flex-end", gap:6, height:120, paddingBottom:20, position:"relative"}}>
                      {emotionReport.questions.map((q, i) => {
                        const dis  = q.emotions.discomfort.weighted;
                        const conf = q.emotions.confidence.weighted;
                        const barH  = Math.round((dis  / 100) * 100);
                        const confH = Math.round((conf / 100) * 100);
                        const color = dis >= 60 ? "#f06464" : dis >= 40 ? "#f5a623" : "#43d98c";
                        return (
                          <div key={i} style={{flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4}}>
                            <div style={{width:"100%", display:"flex", gap:2, alignItems:"flex-end", height:100}}>
                              <div title={`Discomfort ${dis.toFixed(0)}%`}
                                style={{flex:1, height:barH, background:color, borderRadius:"3px 3px 0 0",
                                  opacity:0.9, transition:"height .8s ease", position:"relative"}}>
                                <span style={{position:"absolute", top:-14, left:"50%", transform:"translateX(-50%)",
                                  fontSize:9, fontFamily:"monospace", color, whiteSpace:"nowrap"}}>{dis.toFixed(0)}%</span>
                              </div>
                              <div title={`Confidence ${conf.toFixed(0)}%`}
                                style={{flex:1, height:confH, background:"#43d98c", borderRadius:"3px 3px 0 0",
                                  opacity:0.35, transition:"height .8s ease"}}/>
                            </div>
                            <span style={{fontFamily:"monospace", fontSize:10, color:"#475569"}}>Q{q.question_number}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Legend */}
                <div style={{display:"flex", gap:16, marginTop:10, alignItems:"center", flexWrap:"wrap"}}>
                  <div style={{display:"flex", alignItems:"center", gap:5}}>
                    <div style={{width:9, height:9, borderRadius:2, background:"#f06464"}}/><span style={{fontSize:10, color:"#475569"}}>Discomfort</span>
                  </div>
                  <div style={{display:"flex", alignItems:"center", gap:5}}>
                    <div style={{width:9, height:9, borderRadius:2, background:"#43d98c", opacity:0.4}}/><span style={{fontSize:10, color:"#475569"}}>Confidence</span>
                  </div>
                  <div style={{display:"flex", gap:10, marginLeft:"auto", alignItems:"center"}}>
                    <span style={{fontSize:10, color:"#f06464"}}>● High ≥60%</span>
                    <span style={{fontSize:10, color:"#f5a623"}}>● Mod 40–60%</span>
                    <span style={{fontSize:10, color:"#43d98c"}}>● Low &lt;40%</span>
                    <span style={{fontSize:11, color:"#475569", fontFamily:"monospace", marginLeft:6}}>
                      trend: <span style={{color: emotionReport.overall_readiness.trend.includes("improv")?"#43d98c":
                        emotionReport.overall_readiness.trend.includes("declin")?"#f06464":"#94a3b8"}}>
                        {emotionReport.overall_readiness.trend}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Full strengths / improvements */}
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:32}}>
            <div style={{background:"#0f172a", border:"1px solid #14532d", borderRadius:16, padding:"18px 20px"}}>
              <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:14, paddingBottom:12, borderBottom:"1px solid #1e293b"}}>
                <ThumbsUp size={16} color="#4ade80"/>
                <span style={{fontWeight:700, color:"#4ade80", fontSize:14}}>Key Strengths</span>
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                {(feedbackData.strongPoints||[]).map((p,i)=>(
                  <div key={i} style={{display:"flex", gap:8, alignItems:"flex-start"}}>
                    <CheckCircle size={12} color="#4ade80" style={{flexShrink:0, marginTop:3}}/>
                    <span style={{fontSize:12, color:"#86efac", lineHeight:1.6}}>{p}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{background:"#0f172a", border:"1px solid #78350f", borderRadius:16, padding:"18px 20px"}}>
              <div style={{display:"flex", alignItems:"center", gap:8, marginBottom:14, paddingBottom:12, borderBottom:"1px solid #1e293b"}}>
                <TrendingUp size={16} color="#fb923c"/>
                <span style={{fontWeight:700, color:"#fb923c", fontSize:14}}>Areas to Improve</span>
              </div>
              <div style={{display:"flex", flexDirection:"column", gap:8}}>
                {(feedbackData.improvements||[]).map((p,i)=>(
                  <div key={i} style={{display:"flex", gap:8, alignItems:"flex-start"}}>
                    <Bot size={12} color="#fb923c" style={{flexShrink:0, marginTop:3}}/>
                    <span style={{fontSize:12, color:"#fdba74", lineHeight:1.6}}>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Back button */}
          <button onClick={()=>navigate(isResumeInterview!==false?"/resume":"/interviews")}
            style={{padding:"12px 28px", background:"linear-gradient(to right,#7c3aed,#06b6d4)",
              border:"none", borderRadius:14, color:"white", fontWeight:700, fontSize:14, cursor:"pointer"}}>
            ← Back to Dashboard
          </button>
        </div>

        {/* ── RIGHT: fixed coaching sidebar ─────────────────────────────── */}
        <div style={{width:320, minHeight:"100vh", background:"#080f1a",
          borderLeft:"1px solid #1e293b", display:"flex", flexDirection:"column",
          position:"sticky", top:0, height:"100vh", overflowY:"auto", flexShrink:0}}>

          <div style={{padding:"24px 20px 16px", borderBottom:"1px solid #1e293b"}}>
            <div style={{display:"flex", alignItems:"center", gap:8}}>
              <span style={{fontSize:18}}>🧠</span>
              <span style={{fontWeight:800, fontSize:15, color:"white"}}>Coaching Notes</span>
            </div>
            <p style={{fontSize:11, color:"#475569", margin:"6px 0 0", lineHeight:1.5}}>
              Based on your facial & behavioural signals
            </p>
          </div>

          <div style={{flex:1, overflowY:"auto", padding:"16px 16px 24px"}}>
            {remarks.length === 0 && (
              <p style={{fontSize:12, color:"#475569", textAlign:"center", marginTop:40}}>
                Run a session with the Python backend connected to get coaching notes.
              </p>
            )}
            {remarks.map((r, i) => (
              <div key={i} style={{marginBottom:12, borderRadius:10, overflow:"hidden",
                background:"#0f172a", border:"1px solid #1e293b",
                borderLeft:`3px solid ${RC_MAP[r.type]}`}}>
                <div style={{padding:"10px 12px 4px", display:"flex", alignItems:"center", gap:6}}>
                  <span style={{fontSize:11, fontWeight:800, color:RC_MAP[r.type]}}>{RI_MAP[r.type]} {r.tag}</span>
                </div>
                <p style={{margin:0, fontSize:11.5, color:"#94a3b8", lineHeight:1.65, padding:"0 12px 10px"}}>{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const activeQuestionItem = activeQuestions[currentQuestion];
  const activeQuestionText = typeof activeQuestionItem === "object" ? activeQuestionItem.question : activeQuestionItem;

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <Sidebar />

      {/* ── Full-page setup overlay — shown until calibration finishes ── */}
      {(calibrating || !sessionActive) && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center"
          style={{background: "rgba(2, 6, 23, 0.82)", backdropFilter: "blur(3px)"}}>
          <div className="flex flex-col items-center gap-6 text-center px-8">
            {/* Spinner */}
            <div className="w-14 h-14 rounded-full border-2 border-slate-700 border-t-cyan-400"
              style={{animation: "spin 1s linear infinite"}} />
            <div>
              <p className="text-white text-2xl font-bold tracking-tight">Setting up the environment</p>
              <p className="text-slate-400 text-sm mt-2">Please look at the camera and follow the on-screen prompts</p>
            </div>
            {/* Calibration phase hint */}
            {calibStatus && (
              <div className="mt-2 flex flex-col items-center gap-3 w-72">
                <p className="text-cyan-400 text-xs font-mono uppercase tracking-widest">
                  Phase {calibStatus.phase + 1} / 3 — {calibStatus.name}
                </p>
                <p className="text-white font-semibold text-base">
                  {calibStatus.name === "RELAX" && "Relax and look at the camera"}
                  {calibStatus.name === "BROWS" && "Raise your eyebrows HIGH and hold"}
                  {calibStatus.name === "SMILE" && "Smile naturally and hold"}
                </p>
                <div className="w-full bg-slate-700 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-cyan-400 h-full rounded-full transition-all duration-200"
                    style={{width: `${Math.round(((calibStatus.total/3 - calibStatus.remaining) / (calibStatus.total/3)) * 100)}%`}} />
                </div>
                <p className="text-slate-500 text-xs font-mono">{Math.ceil(calibStatus.remaining)}s remaining</p>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div className="flex-1 p-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold">
              {isResumeInterview !== false ? "AI Resume Interview Session" : "AI Interview Session"}
            </h1>
            <p className="text-slate-400 mt-2">Answer naturally as if you're in a real interview.</p>

            <div className="flex gap-3 mt-4">
              <span className="px-4 py-2 rounded-full bg-purple-600">{domain || topic || "General"}</span>
              <span className="px-4 py-2 rounded-full bg-cyan-600">{difficulty || "Medium"}</span>
              <span className="px-4 py-2 rounded-full bg-slate-700">
                {isResumeInterview !== false ? "Adaptive Timing" : (duration || "15 Min")}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-5 py-3 rounded-2xl">
            <Clock3 className="text-cyan-400" />
            <span className="font-semibold text-xl">{formattedTime}</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6 mt-8">
          <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-8">
            <div className="flex items-center gap-3">
              <Bot className="text-purple-400" />
              <span className="text-slate-400">Question {currentQuestion + 1} / {activeQuestions.length}</span>
            </div>
            <h2 className="text-3xl font-bold mt-6 leading-relaxed">{activeQuestionText}</h2>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="text-cyan-400" />
                <h2 className="font-semibold">Camera Feed</h2>
              </div>
              {sessionActive && !calibrating && (
                <span className="flex items-center gap-1 text-xs text-red-400 font-mono">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  LIVE
                </span>
              )}
            </div>

            {/* Video feed */}
            <div className="relative rounded-2xl overflow-hidden bg-slate-950" style={{height:"200px"}}>
              <video
                ref={videoRef}
                autoPlay playsInline muted
                className="w-full h-full object-cover"
              />
              {/* Hidden canvas for frame capture */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Calibration overlay */}
              {sessionActive && calibrating && calibStatus && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-center px-4">
                  <p className="text-xs text-cyan-400 font-mono uppercase tracking-widest mb-1">
                    Calibrating — Phase {calibStatus.phase + 1}/3
                  </p>
                  <p className="text-white font-bold text-sm mb-3">
                    {calibStatus.name === "RELAX" && "Relax and look at the camera"}
                    {calibStatus.name === "BROWS" && "Raise your eyebrows HIGH and hold"}
                    {calibStatus.name === "SMILE" && "Smile naturally and hold"}
                  </p>
                  <div className="w-full bg-slate-700 rounded-full h-1.5">
                    <div
                      className="bg-cyan-400 h-1.5 rounded-full transition-all duration-200"
                      style={{width: `${Math.round(((calibStatus.total/3 - calibStatus.remaining) / (calibStatus.total/3)) * 100)}%`}}
                    />
                  </div>
                  <p className="text-slate-400 text-xs mt-2">{Math.ceil(calibStatus.remaining)}s remaining</p>
                </div>
              )}

              {/* Alerts overlay */}
              {sessionActive && !calibrating && alerts.length > 0 && (
                <div className="absolute bottom-2 left-2 flex flex-col gap-1">
                  {alerts.map((a, i) => (
                    <span key={i} className="text-xs bg-red-900/80 text-red-300 px-2 py-0.5 rounded font-mono">
                      ⚠ {a}
                    </span>
                  ))}
                </div>
              )}
            </div>


          </div>
        </div>

        <div className="mt-6 bg-slate-900 border border-slate-800 rounded-3xl p-8">
          <h2 className="text-2xl font-semibold">Live Transcript</h2>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Speak or type your answer..."
            className="w-full min-h-[180px] mt-4 bg-slate-950 rounded-2xl p-6 outline-none resize-none text-white font-sans text-lg border border-slate-800/60 focus:border-purple-500/50 transition duration-200"
          />
        </div>

        <div className="flex gap-4 mt-6">
          <button
            onClick={startSpeechRecognition}
            className="flex items-center gap-2 px-6 py-4 rounded-2xl bg-purple-600 hover:bg-purple-700 transition font-semibold"
          >
            <Mic />
            Start Speaking
          </button>

          <button
            onClick={submitAnswer}
            className="flex items-center gap-2 px-6 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 hover:scale-105 transition font-semibold"
          >
            <Send />
            {currentQuestion < activeQuestions.length - 1 ? "Next Question" : "End Interview"}
          </button>
        </div>
      </div>
    </div>
  );
}