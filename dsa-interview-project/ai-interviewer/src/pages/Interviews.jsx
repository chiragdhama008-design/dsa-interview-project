import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import { Brain, Clock, Play, Loader2 } from "lucide-react";

export default function Interviews() {
  const navigate = useNavigate();

  const [domain, setDomain] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [duration, setDuration] = useState("");
  const [loading, setLoading] = useState(false);

  const domains = ["DSA", "Web Dev", "DBMS", "OS", "OOP", "CN"];
  const difficulties = ["Easy", "Medium", "Hard"];
  const durations = ["15 Min", "30 Min", "45 Min"];

  const handleStartInterview = async () => {
    if (!domain || !difficulty || !duration) {
      alert("Please select all interview settings.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("http://localhost:5000/api/interview/generate-topic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, difficulty, duration })
      });

      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || "Failed to generate track questions.");

      navigate("/room", {
        state: {
          domain,
          difficulty,
          duration,
          customQuestions: data.questions,
          isResumeInterview: false,
          topic: domain
        },
      });
    } catch (err) {
      console.error(err);
      alert("Error starting AI Interview session: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <Sidebar />

      <div className="flex-1 p-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold">Interview Center</h1>
          <p className="text-slate-400 mt-2">Configure your interview and start practicing.</p>
        </div>

        {/* Main Card */}
        <div className="mt-8 bg-slate-900 border border-slate-800 rounded-3xl p-8">
          {/* Domain */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Brain className="text-purple-400" />
              <h2 className="text-2xl font-semibold">Choose Domain</h2>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {domains.map((item) => (
                <button
                  key={item}
                  disabled={loading}
                  onClick={() => setDomain(item)}
                  className={`p-4 rounded-2xl border transition-all duration-300 ${
                    domain === item
                      ? "bg-purple-600 border-purple-500 shadow-lg shadow-purple-900/40"
                      : "bg-slate-950 border-slate-700 hover:border-purple-500"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty */}
          <div className="mt-10">
            <h2 className="text-2xl font-semibold mb-4">Difficulty</h2>
            <div className="flex gap-4">
              {difficulties.map((item) => (
                <button
                  key={item}
                  disabled={loading}
                  onClick={() => setDifficulty(item)}
                  className={`px-6 py-3 rounded-xl border transition-all duration-300 ${
                    difficulty === item
                      ? "bg-cyan-600 border-cyan-500 shadow-lg shadow-cyan-900/40"
                      : "border-slate-700 hover:border-cyan-500"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div className="mt-10">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="text-cyan-400" />
              <h2 className="text-2xl font-semibold">Duration</h2>
            </div>

            <div className="flex gap-4">
              {durations.map((item) => (
                <button
                  key={item}
                  disabled={loading}
                  onClick={() => setDuration(item)}
                  className={`px-6 py-3 rounded-xl border transition-all duration-300 ${
                    duration === item
                      ? "bg-purple-600 border-purple-500 shadow-lg shadow-purple-900/40"
                      : "border-slate-700 hover:border-purple-500"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="mt-10 bg-slate-950 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-xl font-semibold mb-4">Interview Summary</h3>
            <p className="text-slate-300">Domain: <span className="text-purple-400">{domain || "Not Selected"}</span></p>
            <p className="text-slate-300 mt-2">Difficulty: <span className="text-cyan-400">{difficulty || "Not Selected"}</span></p>
            <p className="text-slate-300 mt-2">Duration: <span className="text-purple-400">{duration || "Not Selected"}</span></p>
          </div>

          {/* Start Button */}
          <button
            onClick={handleStartInterview}
            disabled={loading}
            className="mt-8 flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 hover:scale-105 transition font-semibold disabled:opacity-50 disabled:pointer-events-none"
          >
            {loading ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Generating AI Questions...
              </>
            ) : (
              <>
                <Play size={20} />
                Start Interview
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}