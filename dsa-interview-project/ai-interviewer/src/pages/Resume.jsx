import { useState } from "react";
import Sidebar from "../components/Sidebar";
import { Upload, FileText, Sparkles, Video } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Resume() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [error, setError] = useState("");
  const [resumeData, setResumeData] = useState(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setResumeData(null); 
      setError("");
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === "application/pdf") {
        setFile(droppedFile);
        setResumeData(null);
        setError("");
      } else {
        setError("Please upload a PDF file only.");
      }
    }
  };

  const uploadResume = async () => {
    if (!file) {
      setError("Please select a PDF file.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const formData = new FormData();
      formData.append("resume", file);

      const response = await fetch("http://localhost:5000/api/resume/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Upload failed");
      }

      console.log("Backend Response Checked:", data);
      
      const finalizedPayload = data.data ? data.data : data;
      
      if (!finalizedPayload.id) {
        console.warn("Warning: No database ID found on the payload structure.", finalizedPayload);
      }

      setResumeData(finalizedPayload); 
      localStorage.setItem("lastActiveResumeId", finalizedPayload.id);
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to upload resume");
    } finally {
      setLoading(false);
    }
  };

  const handleStartInterview = async () => {
    if (!resumeData || !resumeData.id) {
      setError("Please analyze your resume first to register a valid record or check your backend response schema.");
      return;
    }

    try {
      setInterviewLoading(true);
      setError("");

      const response = await fetch("http://localhost:5000/api/interview/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeId: resumeData.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Could not compile interview questions.");
      }

      // FIXED: Route explicitly to /room instead of /interviews to bypass selection configuration panels
      navigate("/room", {
        state: {
          customQuestions: data.questions,
          domain: resumeData.role || "Technical Role",
          difficulty: resumeData.difficulty || "Intermediate",
          isResumeInterview: true,
        }
      });

    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to establish interview pipeline.");
    } finally {
      setInterviewLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-950 text-white">
      <Sidebar />

      <div className="flex-1 p-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold">Resume Management</h1>
          <p className="text-slate-400 mt-2">
            Upload your resume to generate personalized AI interviews.
          </p>
        </div>

        {/* Upload Area */}
        <div
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="mt-8 border-2 border-dashed border-purple-500 rounded-3xl p-12 text-center bg-slate-900/40 transition hover:bg-slate-900/60"
        >
          <Upload size={60} className="mx-auto text-purple-400" />
          <h2 className="text-2xl font-semibold mt-4">Drag & Drop Resume</h2>
          <p className="text-slate-400 mt-2">PDF files only</p>

          <label className="inline-block mt-6 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 cursor-pointer transition">
            Browse Files
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        </div>

        {/* Uploaded Resume Status */}
        {file && (
          <div className="mt-8 bg-slate-900 border border-slate-800 rounded-3xl p-6">
            <h2 className="text-2xl font-semibold mb-4">Uploaded Resume</h2>
            <div className="flex items-center gap-3">
              <FileText className="text-cyan-400" />
              <span>{file.name}</span>
            </div>
            <p className="text-green-400 mt-3">Status: Ready</p>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mt-6 bg-red-500/10 border border-red-500 rounded-xl p-4 text-red-400">
            {error}
          </div>
        )}

        {/* Control Workflow Layout buttons */}
        <div className="flex items-center gap-4 mt-8">
          {file && !resumeData && (
            <button
              onClick={uploadResume}
              disabled={loading}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 font-semibold hover:scale-105 transition disabled:opacity-50"
            >
              <Sparkles size={20} />
              {loading ? "Analyzing Resume..." : "Analyze Resume"}
            </button>
          )}

          {resumeData && (
            <button
              onClick={handleStartInterview}
              disabled={interviewLoading}
              className="flex items-center gap-3 px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 font-bold hover:scale-105 transition disabled:opacity-50 shadow-xl shadow-purple-900/20"
            >
              <Video size={20} className="text-cyan-300 animate-pulse" />
              {interviewLoading ? "Assembling Interview..." : "Start AI Resume Interview"}
            </button>
          )}
        </div>

        {/* AI Detected Skills */}
        {resumeData?.skills && Array.isArray(resumeData.skills) && (
          <div className="mt-8 bg-slate-900 border border-slate-800 rounded-3xl p-6">
            <h2 className="text-2xl font-semibold mb-4">AI Detected Skills</h2>
            <div className="flex flex-wrap gap-3">
              {resumeData.skills.map((skill) => (
                <span
                  key={skill}
                  className="px-4 py-2 rounded-full bg-purple-600/20 border border-purple-500 text-purple-300"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* AI Analysis Output */}
        {resumeData && (
          <div className="mt-8 bg-slate-900 border border-slate-800 rounded-3xl p-6">
            <h2 className="text-2xl font-semibold mb-4">AI Resume Analysis</h2>
            <div className="space-y-3">
              <p>
                <span className="font-semibold text-cyan-400">Suggested Role:</span>{" "}
                {resumeData.role || "N/A"}
              </p>
              <p>
                <span className="font-semibold text-cyan-400">Difficulty:</span>{" "}
                {resumeData.difficulty || "N/A"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}