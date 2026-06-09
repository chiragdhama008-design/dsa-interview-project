import ai from "../config/gemini.js";
import supabase from "../config/supabase.js";
import { Type } from "@google/genai";

// 1. Keep your existing generateQuestions logic intact
export const generateQuestions = async (req, res) => {
  try {
    const { resumeId } = req.body;
    if (!resumeId) return res.status(400).json({ success: false, message: "Missing parameter: resumeId is required." });

    const { data: resumeData, error } = await supabase.from("resumes").select("*").eq("id", resumeId).single();
    if (error || !resumeData) return res.status(404).json({ success: false, message: "Resume record not found." });

    const resumeText = resumeData.parsed_text;
    const prompt = `You are an expert technical interviewer. Analyze the candidate's resume below and generate exactly 10 relevant, short technical interview questions matching role: ${resumeData.role || "Software Engineer"} and difficulty: ${resumeData.difficulty || "Intermediate"}.\n\nContext:\n${resumeText}\n\nReturn ONLY a JSON string array of questions.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    });

    const questions = JSON.parse(response.text);
    const rows = questions.map((q) => ({ resume_id: resumeId, question: q }));
    
    // Clear out old questions for this resume to start fresh
    await supabase.from("questions").delete().eq("resume_id", resumeId);
    
    const { error: insertError } = await supabase.from("questions").insert(rows);
    if (insertError) throw new Error(`Supabase DB Write Error: ${insertError.message}`);

    return res.status(200).json({ success: true, questions });
  } catch (err) {
    console.error("Exception:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 2. NEW: Process Answers & Run Gemini Feedback Evaluation Evaluation
export const evaluateInterview = async (req, res) => {
  try {
    const { resumeId, interviewAnswers } = req.body; // interviewAnswers format: [{ questionText, answerText }]

    if (!resumeId || !interviewAnswers || !Array.isArray(interviewAnswers)) {
      return res.status(400).json({ success: false, message: "Missing required properties: resumeId or answers array." });
    }

    // A. Update user responses dynamically inside the 'questions' table
    for (const item of interviewAnswers) {
      await supabase
        .from("questions")
        .update({ user_answer: item.answerText })
        .eq("resume_id", resumeId)
        .eq("question", item.questionText);
    }

    // B. Build an evaluation summary prompt for Gemini
    let transcriptBlock = "";
    interviewAnswers.forEach((item, index) => {
      transcriptBlock += `\nQuestion ${index + 1}: ${item.questionText}\nCandidate Answer: ${item.answerText || "[No Answer Supplied]"}\n`;
    });

    const evaluationPrompt = `
      You are an expert engineering manager evaluating a technical interview candidate transcript.
      Analyze the performance logs provided below:

      ${transcriptBlock}

      Provide constructive evaluation feedback:
      - Assign an overall percentage score (0 to 100) based on conceptual technical accuracy.
      - Write clear, bulleted items detailing strong answers and clear suggestions for improvement.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: evaluationPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER },
            critique: { type: Type.STRING }
          },
          required: ["score", "critique"]
        }
      }
    });

    const feedbackResult = JSON.parse(response.text);

    // C. Commit overall session assessment metrics directly to Supabase
    const { data: sessionRecord, error: sessionErr } = await supabase
      .from("interview_sessions")
      .insert([
        {
          resume_id: resumeId,
          overall_score: feedbackResult.score,
          feedback: feedbackResult.critique
        }
      ])
      .select()
      .single();

    if (sessionErr) throw new Error(`Session Insert Error: ${sessionErr.message}`);

    return res.status(200).json({
      success: true,
      score: feedbackResult.score,
      feedback: feedbackResult.critique,
    });

  } catch (err) {
    console.error("Evaluation pipeline crashed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};