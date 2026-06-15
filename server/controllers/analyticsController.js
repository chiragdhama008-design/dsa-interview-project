import supabase from "../config/supabase.js";

export const getUserAnalyticsData = async (req, res) => {
  try {
    // Fetch historical tracking sessions from Supabase
    const { data: sessions, error } = await supabase
      .from("interview_sessions")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) throw error;

    if (!sessions || sessions.length === 0) {
      return res.status(200).json({
        success: true,
        metrics: {
          totalInterviews: 0,
          averageScore: 0,
          skillsTestedCount: 0,
          recentInterviews: [],
          scoreTrend: [],
          skillDistribution: []
        }
      });
    }

    // Top Level Aggregates
    const totalInterviews = sessions.length;
    const totalScoreSum = sessions.reduce((sum, s) => sum + (s.overall_score || 0), 0);
    const averageScore = Math.round(totalScoreSum / totalInterviews);

    // Compute unique text tags
    const uniqueTopics = new Set(sessions.map(s => s.topic || "Resume Matrix").filter(Boolean));
    const skillsTestedCount = uniqueTopics.size;

    // Timeline Progression Array Mapping
    const scoreTrend = sessions.map((s, idx) => ({
      name: new Date(s.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      score: s.overall_score,
      sessionNum: `Session ${idx + 1}`
    }));

    // Calculate distributions for the Skill Breakdown circular ring graphics
    const topicTracker = {};
    sessions.forEach(s => {
      const topicName = s.topic || "Resume Analysis";
      if (!topicTracker[topicName]) {
        topicTracker[topicName] = { sum: 0, count: 0 };
      }
      topicTracker[topicName].sum += (s.overall_score || 0);
      topicTracker[topicName].count += 1;
    });

    const skillDistribution = Object.keys(topicTracker).map(topic => ({
      subject: topic,
      score: Math.round(topicTracker[topic].sum / topicTracker[topic].count),
      fullMark: 100
    }));

    // Slice recent feeds
    const recentInterviews = [...sessions]
      .reverse()
      .slice(0, 3)
      .map(s => {
        let cleanFeedback = {};
        try {
          cleanFeedback = typeof s.feedback === "string" ? JSON.parse(s.feedback) : s.feedback;
        } catch (e) {
          cleanFeedback = {};
        }
        return {
          id: s.id,
          title: s.topic ? `${s.topic} Interview` : "Resume Valuation",
          score: s.overall_score,
          summary: cleanFeedback.summary || "Performance metadata calculated cleanly."
        };
      });

    return res.status(200).json({
      success: true,
      metrics: {
        totalInterviews,
        averageScore,
        skillsTestedCount,
        recentInterviews,
        scoreTrend,
        skillDistribution
      }
    });

  } catch (err) {
    console.error("Analytics failure:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};