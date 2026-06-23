import ai from "../config/gemini.js";
import supabase from "../config/supabase.js";
import { Type } from "@google/genai";

// 1. Corrected Resume Question Generator
export const generateQuestions = async (req, res) => {
  try {
    const { resumeId } = req.body;
    if (!resumeId) return res.status(400).json({ success: false, message: "Missing parameter: resumeId is required." });

    // FIX: Safely cast to numerical base-10 integer to fit your database schema's int8 layout
    const parsedResumeId = parseInt(resumeId, 10);
    if (isNaN(parsedResumeId)) {
      return res.status(400).json({ success: false, message: "Invalid resumeId structure provided." });
    }

    const { data: resumeData, error } = await supabase.from("resumes").select("*").eq("id", parsedResumeId).single();
    if (error || !resumeData) return res.status(404).json({ success: false, message: "Resume record not found." });

    const resumeText = resumeData.parsed_text;
    const prompt = `You are an expert technical interviewer. Analyze the candidate's resume below and generate exactly 10 relevant, short technical interview questions matching role: ${resumeData.role || "Software Engineer"} and difficulty: ${resumeData.difficulty || "Intermediate"}.
    
    CRITICAL RULE: Every generated question must map cleanly to an actual problem variation or conceptual topic frequently targeted by top-tier multinational corporations (e.g., Google, Microsoft, Amazon, Meta, Netflix, Apple). Assign the precise company tag and write a 1-sentence real-world interview execution context explaining why it fits.

    Context:
    ${resumeText}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: { 
          type: Type.ARRAY, 
          items: { 
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              companyTag: { type: Type.STRING },
              realWorldContext: { type: Type.STRING }
            },
            required: ["question", "companyTag", "realWorldContext"]
          }
        },
      },
    });

    const questionsData = JSON.parse(response.text);
    
    const rows = questionsData.map((q) => ({ 
      resume_id: parsedResumeId, 
      question: q.question,
      company_tag: q.companyTag,
      real_world_context: q.realWorldContext
    }));
    
    // Clear old versions
    await supabase.from("questions").delete().eq("resume_id", parsedResumeId);
    
    const { error: insertError } = await supabase.from("questions").insert(rows);
    if (insertError) throw new Error(`Supabase DB Write Error: ${insertError.message}`);

    return res.status(200).json({ success: true, questions: rows });
  } catch (err) {
    console.error("Exception:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 2. Corrected Topic Question Generator
export const generateTopicQuestions = async (req, res) => {
  try {
    const { domain, difficulty, duration } = req.body;

    if (!domain || !difficulty) {
      return res.status(400).json({ success: false, message: "Missing required selection metrics: domain and difficulty." });
    }

    const prompt = `You are an expert technical interviewer. Generate exactly 10 highly professional, relevant technical interview questions for the following domain: "${domain}".
    Target difficulty level configuration: "${difficulty}". Estimated interview execution window: ${duration || "15 Min"}.
    
    CRITICAL RULE: Every generated question must map cleanly to an actual problem variation or conceptual topic frequently targeted by top-tier multinational corporations (e.g., Google, Microsoft, Amazon, Meta, Netflix, Apple). Assign the precise company tag and write a 1-sentence real-world interview execution context explaining why it fits.`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: { 
          type: Type.ARRAY, 
          items: { 
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              companyTag: { type: Type.STRING },
              realWorldContext: { type: Type.STRING }
            },
            required: ["question", "companyTag", "realWorldContext"]
          }
        },
      },
    });

    const questionsData = JSON.parse(response.text);

    await supabase.from("questions").delete().eq("topic", domain).is("resume_id", null);

    const rows = questionsData.map((q) => ({
      topic: domain,
      question: q.question,
      company_tag: q.companyTag,
      real_world_context: q.realWorldContext,
      user_answer: null
    }));

    const { error: insertError } = await supabase.from("questions").insert(rows);
    if (insertError) throw new Error(`Supabase DB Write Error: ${insertError.message}`);

    return res.status(200).json({ success: true, questions: rows });
  } catch (err) {
    console.error("Topic generation core exception:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// 3. Corrected Unified Evaluation Pipeline
export const evaluateInterview = async (req, res) => {
  try {
    const { resumeId, topic, interviewAnswers } = req.body; 

    if (!interviewAnswers || !Array.isArray(interviewAnswers)) {
      return res.status(400).json({ success: false, message: "Missing required properties: interviewAnswers array." });
    }

    const parsedResumeId = resumeId ? parseInt(resumeId, 10) : null;

    for (const item of interviewAnswers) {
      let query = supabase
        .from("questions")
        .update({ user_answer: item.answerText })
        .eq("question", item.questionText);

      if (parsedResumeId && !isNaN(parsedResumeId)) {
        query = query.eq("resume_id", parsedResumeId);
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

    const feedbackResult = JSON.parse(response.text);

    const sessionData = {
      overall_score: feedbackResult.score,
      feedback: JSON.stringify(feedbackResult)
    };

    if (parsedResumeId && !isNaN(parsedResumeId)) sessionData.resume_id = parsedResumeId;
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