import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mic, Camera, Clock3, Send, Bot, Award, CheckCircle, RefreshCw } from "lucide-react";
import Sidebar from "../components/Sidebar";

export default function InterviewRoom() {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    domain,
    difficulty,
    duration,
    customQuestions,
    isResumeInterview
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
      default: return 15 * 60;
    }
  };

  const [timeLeft, setTimeLeft] = useState(getInitialTime());
  const [transcript, setTranscript] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState(0);
  
  // Track structured question & answer pairs
  const [historyLog, setHistoryLog] = useState([]);
  
  // Evaluation States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackData, setFeedbackData] = useState(null);

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

    // Store the pair matching backend parameter rules
    const updatedHistory = [
      ...historyLog,
      { questionText: activeQuestions[currentQuestion], answerText: transcript }
    ];
    setHistoryLog(updatedHistory);

    if (currentQuestion < activeQuestions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setTranscript("");
    } else {
      // LAST QUESTION COMPLETED: Trigger database storage and fetch AI evaluation reports
      try {
        setIsSubmitting(true);
        
        // Locate resumeId safely out of active storage references if required
        const storedResumeId = location.state?.resumeId || localStorage.getItem("lastActiveResumeId") || 1;

        const response = await fetch("http://localhost:5000/api/interview/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resumeId: storedResumeId,
            interviewAnswers: updatedHistory
          })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Failed to parse feedback.");

        setFeedbackData(data); // Switches screen to full report dashboard view
      } catch (err) {
        console.error(err);
        alert("Error compiling feedback metrics: " + err.message);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formattedTime = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

  // ==========================================
  // RENDER OPTION A: LOADING/SUBMITTING REPORT
  // ==========================================
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
  // RENDER OPTION B: SHOW DETAILED FEEDBACK DASHBOARD
  // ==========================================
  if (feedbackData) {
    return (
      <div className="flex min-h-screen bg-slate-950 text-white">
        <Sidebar />
        <div className="flex-1 p-8 max-w-4xl mx-auto space-y-8">
          <div className="flex items-center gap-4 border-b border-slate-800 pb-6">
            <div className="p-3 bg-green-500/10 text-green-400 rounded-2xl">
              <CheckCircle size={36} />
            </div>
            <div>
              <h1 className="text-4xl font-extrabold tracking-tight">Interview Report</h1>
              <p className="text-slate-400 mt-1">Your responses have been saved to Supabase successfully.</p>
            </div>
          </div>

          {/* Metric Dashboard */}
          <div className="grid grid-cols-3 gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center">
              <Award size={32} className="text-amber-400 mx-auto mb-2" />
              <div className="text-sm text-slate-400 font-medium uppercase">Overall Grade</div>
              <div className="text-5xl font-black text-white mt-1">{feedbackData.score}%</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 col-span-2 flex flex-col justify-center">
              <div className="text-slate-400 text-sm font-medium uppercase">Session Context</div>
              <div className="text-xl font-bold mt-2 text-cyan-300">{domain || "Software Engineer"}</div>
              <div className="text-slate-400 text-sm mt-1">Target Difficulty Level: <span className="text-purple-400 font-semibold">{difficulty || "Intermediate"}</span></div>
            </div>
          </div>

          {/* Detailed Bullet Analysis Box */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
              <Bot size={22} className="text-purple-400" />
              AI Comprehensive Feedback
            </h2>
            <div className="text-slate-300 text-lg leading-relaxed whitespace-pre-line bg-slate-950 p-6 rounded-2xl border border-slate-800/80">
              {feedbackData.feedback}
            </div>
          </div>

          <button
            onClick={() => navigate("/resume")}
            className="px-8 py-4 bg-purple-600 hover:bg-purple-700 transition font-bold text-lg rounded-2xl w-full sm:w-auto"
          >
            Return to Resume Portal
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // RENDER OPTION C: ACTIVE LIVE INTERVIEW ROOM
  // ==========================================
  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <Sidebar />

      <div className="flex-1 p-8">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-4xl font-bold">
              {isResumeInterview ? "AI Resume Interview Session" : "AI Interview Session"}
            </h1>
            <p className="text-slate-400 mt-2">
              Answer naturally as if you're in a real interview.
            </p>

            <div className="flex gap-3 mt-4">
              <span className="px-4 py-2 rounded-full bg-purple-600">
                {domain || "General"}
              </span>
              <span className="px-4 py-2 rounded-full bg-cyan-600">
                {difficulty || "Medium"}
              </span>
              <span className="px-4 py-2 rounded-full bg-slate-700">
                {isResumeInterview ? "Adaptive Timing" : (duration || "15 Min")}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-slate-900 border border-slate-800 px-5 py-3 rounded-2xl">
            <Clock3 className="text-cyan-400" />
            <span className="font-semibold text-xl">{formattedTime}</span>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-3 gap-6 mt-8">
          <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-8">
            <div className="flex items-center gap-3">
              <Bot className="text-purple-400" />
              <span className="text-slate-400">
                Question {currentQuestion + 1} / {activeQuestions.length}
              </span>
            </div>
            <h2 className="text-3xl font-bold mt-6 leading-relaxed">
              {typeof activeQuestions[currentQuestion] === 'object' 
                ? activeQuestions[currentQuestion].question 
                : activeQuestions[currentQuestion]}
            </h2>
          </div>

          {/* Webcam Placeholder */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6">
            <div className="flex items-center gap-2">
              <Camera className="text-cyan-400" />
              <h2 className="font-semibold">Camera Feed</h2>
            </div>
            <div className="mt-4 h-72 rounded-2xl bg-slate-950 flex items-center justify-center">
              <Camera size={50} className="text-slate-700" />
            </div>
          </div>
        </div>

        {/* Transcript Box */}
        <div className="mt-6 bg-slate-900 border border-slate-800 rounded-3xl p-8">
          <h2 className="text-2xl font-semibold">Live Transcript</h2>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Speak or type your answer..."
            className="w-full min-h-[180px] mt-4 bg-slate-950 rounded-2xl p-6 outline-none resize-none text-white font-sans text-lg border border-slate-800/60 focus:border-purple-500/50 transition duration-200"
          />
        </div>

        {/* Controls Layout */}
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
            Submit Answer
          </button>
        </div>
      </div>
    </div>
  );
}