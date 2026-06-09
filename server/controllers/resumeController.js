import pdfParse from "pdf-parse-fork";
import supabase from "../config/supabase.js";
import { GoogleGenAI, Type } from "@google/genai";

export const uploadResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    // ==========================================
    // 1. Parse PDF Text Dynamically
    // ==========================================
    const pdfData = await pdfParse(req.file.buffer);
    const resumeText = pdfData.text || "";

    if (!resumeText.trim()) {
      return res.status(400).json({
        success: false,
        message: "Could not extract any readable text from this PDF.",
      });
    }

    console.log("========== RESUME TEXT ==========");
    console.log(resumeText.substring(0, 500));
    console.log("=================================");

    // ==========================================
    // 2. Initialize Default Analysis Framework
    // ==========================================
    let parsedAnalysis = {
      skills: [],
      role: "Software Engineer",
      difficulty: "Intermediate",
    };

    // ==========================================
    // 3. Query Gemini AI Processing
    // ==========================================
    try {
      // Instantiating the client inside the route block ensures process environment keys are loaded
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const prompt = `
Analyze this candidate's resume.

Resume:
${resumeText}

Return:
- skills (max 8)
- role
- difficulty

Difficulty must be:
Beginner, Intermediate, or Advanced.
`;

      const aiResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              skills: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              role: { type: Type.STRING },
              difficulty: { type: Type.STRING },
            },
            required: ["skills", "role", "difficulty"],
          },
        },
      });

      parsedAnalysis = JSON.parse(aiResponse.text);
      console.log("🚀 Successfully parsed with Gemini");
    } catch (aiErr) {
      // ⚠️ FALLBACK LANE: Trigger regex backup extraction if Gemini encounters a temporary 503 spike
      console.warn(
        "⚠️ Gemini unavailable. Using fallback parser.",
        aiErr.message
      );

      const textLower = resumeText.toLowerCase();
      const skillBank = [
        "javascript", "react", "node", "express", "mongodb", "python", 
        "java", "cpp", "c++", "sql", "html", "css", "typescript", 
        "aws", "docker", "git"
      ];

      const foundSkills = skillBank.filter((skill) => textLower.includes(skill));

      parsedAnalysis.skills = foundSkills
        .map((skill) =>
          skill === "cpp"
            ? "C++"
            : skill.charAt(0).toUpperCase() + skill.slice(1)
        )
        .slice(0, 8);

      if (textLower.includes("machine learning") || textLower.includes("data scientist")) {
        parsedAnalysis.role = "Data Scientist";
      } else if (textLower.includes("react") || textLower.includes("frontend")) {
        parsedAnalysis.role = "Frontend Engineer";
      } else if (textLower.includes("node") || textLower.includes("backend")) {
        parsedAnalysis.role = "Backend Developer";
      } else {
        parsedAnalysis.role = "Full Stack Developer";
      }

      if (textLower.includes("senior") || textLower.includes("lead")) {
        parsedAnalysis.difficulty = "Advanced";
      } else {
        parsedAnalysis.difficulty = "Intermediate";
      }
    }

    // Safeguard to ensure skills has items even if both parsers find nothing
    const finalSkills = parsedAnalysis.skills?.length > 0
      ? parsedAnalysis.skills
      : ["JavaScript", "React", "Node.js"];

    // ==========================================
    // 4. Record and Commit to Supabase Database
    // ==========================================
    const { data: newResume, error } = await supabase
      .from("resumes")
      .insert([
        {
          parsed_text: resumeText,
          skills: finalSkills,
          role: parsedAnalysis.role,
          difficulty: parsedAnalysis.difficulty,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new Error(`Supabase Insert Error: ${error.message}`);
    }

    // ==========================================
    // 5. Build Unified Payload Back to Client
    // ==========================================
    return res.status(200).json({
      success: true,
      id: newResume.id, // 👈 Aligned with frontend tracking parameter expectations
      message: "Resume processed successfully",
      resumeText: newResume.parsed_text,
      skills: finalSkills,
      role: newResume.role,
      difficulty: newResume.difficulty,
    });
  } catch (err) {
    console.error("Resume Controller Failure:", err);

    return res.status(500).json({
      success: false,
      message: err.message || "Failed to process resume.",
    });
  }
};