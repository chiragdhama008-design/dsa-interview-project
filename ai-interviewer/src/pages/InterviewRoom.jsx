import { useState, useEffect } from "react";
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
      setCurrentQuestion(currentQuestion + 1);
      setTranscript("");
    } else {
      try {
        setIsSubmitting(true);
        
        const bodyPayload = { interviewAnswers: updatedHistory };
        
        if (isResumeInterview !== false && (location.state?.resumeId || localStorage.getItem("lastActiveResumeId"))) {
          bodyPayload.resumeId = location.state?.resumeId || localStorage.getItem("lastActiveResumeId");
        } else {
          bodyPayload.topic = topic || domain || "General Track";
        }

        const response = await fetch("http://localhost:5000/api/interview/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyPayload)
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Failed to parse feedback.");

        setFeedbackData(data); 
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

  if (feedbackData) {
    return (
      <div className="flex min-h-screen bg-slate-950 text-white">
        <Sidebar />
        <div className="flex-1 p-8 max-w-5xl mx-auto space-y-8 overflow-y-auto">
          
          <div className="flex items-center gap-4 border-b border-slate-800 pb-6">
            <div className="p-3 bg-gradient-to-tr from-purple-500 to-cyan-500 text-white rounded-2xl shadow-xl shadow-purple-500/10">
              <CheckCircle size={32} />
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                Interview Performance Review
              </h1>
              <p className="text-slate-400 mt-1">AI performance insights mapped to your track profile logs.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800/80 rounded-3xl p-6 flex flex-col justify-center items-center relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-24 h-24 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition duration-500" />
              <Award size={36} className="text-amber-400 mb-2" />
              <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">Overall Proficiency</div>
              <div className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-200 mt-2">
                {feedbackData.score}%
              </div>
              <div className="w-full bg-slate-800 h-1.5 rounded-full mt-4 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-amber-500 to-yellow-400 h-full rounded-full transition-all duration-1000" 
                  style={{ width: `${feedbackData.score}%` }} 
                />
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800/80 rounded-3xl p-6 col-span-2 flex flex-col justify-center relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-3xl" />
              <div className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Session Context</div>
              <div className="text-2xl font-black text-cyan-400 tracking-wide">
                {domain || topic || "Technical Core Domain"}
              </div>
              <p className="text-slate-400 text-sm mt-1.5 font-medium">
                Target Difficulty Config: <span className="text-purple-400 font-bold">{difficulty || "Intermediate"}</span>
              </p>
              
              {feedbackData.summary && (
                <div className="mt-4 p-3.5 bg-slate-950/80 border border-slate-800/60 rounded-xl flex items-start gap-2.5 text-sm text-slate-300 leading-relaxed">
                  <Sparkles size={16} className="text-purple-400 shrink-0 mt-0.5" />
                  <span>{feedbackData.summary}</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-900/40 border border-green-500/10 rounded-3xl p-6 space-y-4 shadow-xl">
              <h3 className="text-xl font-bold text-green-400 flex items-center gap-2 border-b border-slate-800/80 pb-3">
                <ThumbsUp size={20} />
                Key Strengths Verified
              </h3>
              <ul className="space-y-3">
                {feedbackData.strongPoints && feedbackData.strongPoints.map((point, i) => (
                  <li key={i} className="flex gap-3 bg-slate-950/50 border border-slate-900 p-4 rounded-2xl text-slate-300 text-sm leading-relaxed hover:border-green-500/20 transition">
                    <CheckCircle size={16} className="text-green-500 shrink-0 mt-0.5" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-slate-900/40 border border-amber-500/10 rounded-3xl p-6 space-y-4 shadow-xl">
              <h3 className="text-xl font-bold text-amber-400 flex items-center gap-2 border-b border-slate-800/80 pb-3">
                <TrendingUp size={20} />
                Areas For Improvement
              </h3>
              <ul className="space-y-3">
                {feedbackData.improvements && feedbackData.improvements.map((point, i) => (
                  <li key={i} className="flex gap-3 bg-slate-950/50 border border-slate-900 p-4 rounded-2xl text-slate-300 text-sm leading-relaxed hover:border-amber-500/20 transition">
                    <Bot size={16} className="text-amber-500 shrink-0 mt-0.5" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={() => navigate(isResumeInterview !== false ? "/resume" : "/interviews")}
              className="px-8 py-4 bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90 font-bold text-base rounded-2xl w-full sm:w-auto shadow-lg shadow-purple-600/10 active:scale-98 transition duration-150"
            >
              Return to Dashboard Center
            </button>
          </div>
        </div>
      </div>
    );
  }

  const activeQuestionItem = activeQuestions[currentQuestion];
  const activeQuestionText = typeof activeQuestionItem === "object" ? activeQuestionItem.question : activeQuestionItem;
  
  // Safe validation fallback to handle variable formats interchangeably
  const activeCompanyTag = typeof activeQuestionItem === "object" ? (activeQuestionItem.company_tag || activeQuestionItem.companyTag) : null;
  const activeContext = typeof activeQuestionItem === "object" ? (activeQuestionItem.real_world_context || activeQuestionItem.realWorldContext) : null;

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <Sidebar />

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
          <div className="col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-8 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="flex items-center gap-3">
                  <Bot className="text-purple-400" />
                  <span className="text-slate-400">Question {currentQuestion + 1} / {activeQuestions.length}</span>
                </div>

                {activeCompanyTag && (
                  <div className="group relative flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 shadow-lg cursor-help transition-all hover:bg-indigo-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                    🎯 Asked at <span className="text-white underline decoration-dashed decoration-indigo-400/50 underline-offset-2">{activeCompanyTag}</span>

                    {activeContext && (
                      <div className="absolute bottom-full right-0 mb-2 w-72 p-3 bg-slate-950 border border-slate-800 text-slate-300 rounded-xl text-xs font-normal shadow-2xl opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 transition-all duration-200 z-50 leading-relaxed">
                        <p className="font-bold text-white mb-1">Interview Context:</p>
                        {activeContext}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <h2 className="text-3xl font-bold mt-6 leading-relaxed">{activeQuestionText}</h2>
            </div>
          </div>

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
            Submit Answer
          </button>
        </div>
      </div>
    </div>
  );
}