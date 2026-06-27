import ai from "../config/gemini.js";
import supabase from "../config/supabase.js";

export const evaluateAnswer = async (req, res) => {
  try {
    const { questionId, answer } = req.body;

    const { data: questionData, error } = await supabase
      .from("questions")
      .select("*")
      .eq("id", questionId)
      .single();

    if (error || !questionData) {
      return res.status(404).json({
        message: "Question not found",
      });
    }

    const prompt = `
You are a technical interviewer.

Question:
${questionData.question}

Candidate Answer:
${answer}

Evaluate the answer.

Return ONLY valid JSON.

{
  "score": 0-10,
  "feedback": "Detailed feedback"
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const result = JSON.parse(
      response.text
        .replace(/```json/g, "")
        .replace(/```/g, "")
    );

    const { data, error: insertError } = await supabase
      .from("answers")
      .insert([
        {
          question_id: questionId,
          answer,
          score: result.score,
          feedback: result.feedback,
        },
      ])
      .select();

    if (insertError) {
      return res.status(500).json(insertError);
    }

    res.json({
      score: result.score,
      feedback: result.feedback,
      saved: data,
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: err.message,
    });
  }
};