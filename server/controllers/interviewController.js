import ai from "../config/gemini.js";
import supabase from "../config/supabase.js";
import { Type } from "@google/genai";

// 1. Existing resume question generator tracking logic
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
    
    await supabase.from("questions").delete().eq("resume_id", resumeId);
    
    const { error: insertError } = await supabase.from("questions").insert(rows);
    if (insertError) throw new Error(`Supabase DB Write Error: ${insertError.message}`);

    return res.status(200).json({ success: true, questions });
  } catch (err) {
    console.error("Exception:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 2. Generate 10 specialized topic questions based on dashboard selections
export const generateTopicQuestions = async (req, res) => {
  try {
    const { domain, difficulty, duration } = req.body;

    if (!domain || !difficulty) {
      return res.status(400).json({ success: false, message: "Missing required selection metrics: domain and difficulty." });
    }

    const prompt = `You are an expert technical interviewer. Generate exactly 10 highly professional, relevant technical interview questions for the following domain: "${domain}".
    Target difficulty level configuration: "${difficulty}". Estimated interview execution window: ${duration || "15 Min"}.
    Return ONLY a JSON string array of questions. Do not embed any descriptive prose, extra text wrappers or markdown block tags outside the array format.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
    });

    const questions = JSON.parse(response.text);

    // Clear past standalone domain questions to keep data clean
    await supabase.from("questions").delete().eq("topic", domain).is("resume_id", null);

    const rows = questions.map((q) => ({
      topic: domain,
      question: q,
      user_answer: null
    }));

    const { error: insertError } = await supabase.from("questions").insert(rows);
    if (insertError) throw new Error(`Supabase DB Write Error: ${insertError.message}`);

    return res.status(200).json({ success: true, questions });
  } catch (err) {
    console.error("Topic generation core exception:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 3. UPDATED STYLE PIPELINE: Dynamic full-stack interview script evaluator with Structured Output
export const evaluateInterview = async (req, res) => {
  try {
    const { resumeId, topic, interviewAnswers } = req.body; 

    if (!interviewAnswers || !Array.isArray(interviewAnswers)) {
      return res.status(400).json({ success: false, message: "Missing required properties: interviewAnswers array." });
    }

    // Update user responses inside the database
    for (const item of interviewAnswers) {
      let query = supabase
        .from("questions")
        .update({ user_answer: item.answerText })
        .eq("question", item.questionText);

      if (resumeId) {
        query = query.eq("resume_id", resumeId);
      } else if (topic) {
        query = query.eq("topic", topic).is("resume_id", null);
      }

      await query;
    }

    let transcriptBlock = "";
    interviewAnswers.forEach((item, index) => {
      transcriptBlock += `\nQuestion ${index + 1}: ${item.questionText}\nCandidate Answer: ${item.answerText || "[No Answer Supplied]"}\n`;
    });

    const evaluationPrompt = `
      You are an expert engineering manager evaluating a technical interview candidate transcript.
      Analyze the performance logs provided below:

      ${transcriptBlock}

      Provide your evaluation strictly adhering to the JSON schema:
      - score: integer from 0 to 100.
      - summary: A brief 2-3 sentence introductory overview performance statement.
      - strongPoints: A clean string array highlighting where the candidate showed great technical precision.
      - improvements: A clean string array showing where they can deepen their knowledge or fix conceptual errors.
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
            summary: { type: Type.STRING },
            strongPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            improvements: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ["score", "summary", "strongPoints", "improvements"]
        }
      }
    });

    // Parse the structured data package cleanly
    const feedbackResult = JSON.parse(response.text);

    const sessionData = {
      overall_score: feedbackResult.score,
      feedback: JSON.stringify(feedbackResult) // Storing structured string directly to remain compatible
    };

    if (resumeId) sessionData.resume_id = resumeId;
    if (topic) sessionData.topic = topic;

    const { error: sessionErr } = await supabase
      .from("interview_sessions")
      .insert([sessionData]);

    if (sessionErr) throw new Error(`Session Insert Error: ${sessionErr.message}`);

    return res.status(200).json({
      success: true,
      score: feedbackResult.score,
      summary: feedbackResult.summary,
      strongPoints: feedbackResult.strongPoints,
      improvements: feedbackResult.improvements
    });

  } catch (err) {
    console.error("Evaluation pipeline crashed:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};