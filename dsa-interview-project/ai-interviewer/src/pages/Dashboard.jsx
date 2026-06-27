import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import HeroBanner from "../components/HeroBanner";
import StatCard from "../components/StatCard";
import InterviewCard from "../components/InterviewCard";
import ScoreChart from "../components/ScoreChart";
import { Loader2 } from "lucide-react";

export default function Dashboard() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardMetrics = async () => {
      try {
        const response = await fetch("http://localhost:5000/api/interview/global-analytics");
        const json = await response.json();
        
        if (json.success) {
          const rawMetrics = json.metrics;

          // Days of the week lookup table
          const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

          // Safely format raw database items into objects Recharts understands
          const formattedScoreTrend = (rawMetrics.scoreTrend || []).map((item) => {
            // Fallback to item.day if your backend is already passing a string string day
            let dayLabel = item.day; 

            // If backend passes a timestamp (e.g., 'created_at'), parse it to a weekday
            if (item.created_at) {
              const dateObj = new Date(item.created_at);
              dayLabel = daysOfWeek[dateObj.getDay()];
            }

            return {
              day: dayLabel || "Day",
              score: Number(item.score) || 0, // Ensure score is an absolute number
            };
          });

          // Store the processed data back into state
          setMetrics({
            ...rawMetrics,
            scoreTrend: formattedScoreTrend,
          });
        }
      } catch (err) {
        console.error("Failed fetching live dashboard metrics:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardMetrics();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-slate-950 text-white items-center justify-center">
        <Loader2 className="animate-spin text-purple-500" size={40} />
      </div>
    );
  }

  const data = metrics || {
    totalInterviews: 0,
    averageScore: 0,
    skillsTestedCount: 0,
    recentInterviews: [],
    scoreTrend: []
  };

  const dynamicStats = [
    {
      title: "TOTAL INTERVIEWS",
      value: data.totalInterviews,
      trend: "", 
    },
    {
      title: "AVERAGE SCORE",
      value: `${data.averageScore}%`,
      trend: "",
    },
    {
      title: "SKILLS TESTED",
      value: data.skillsTestedCount,
      trend: "", // Changed from "Distinct areas" for clarity
    }
  ];

  return (
    <div className="flex bg-slate-950 text-white min-h-screen">
      <Sidebar />

      <div className="flex-1 p-8">
        <HeroBanner />

        {/* Real-time Metric Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
          {dynamicStats.map((item) => (
            <StatCard
              key={item.title}
              title={item.title}
              value={item.value}
              trend={item.trend}
            />
          ))}
        </div>

        {/* Dynamic Score Curve Component passing liveData prop */}
        <div className="mt-8">
          <ScoreChart liveData={data.scoreTrend} />
        </div>

        {/* Recent Interviews History Feed */}
        <div className="mt-8">
          <h2 className="text-2xl font-bold mb-4">
            Recent Interviews
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.recentInterviews.length === 0 ? (
              <div className="col-span-3 text-center py-10 text-sm text-slate-500 border border-dashed border-slate-800 rounded-2xl bg-slate-900/10">
                No interview sessions completed yet. Click "Start Interview" to begin!
              </div>
            ) : (
              data.recentInterviews.map((item) => (
                <InterviewCard
                  key={item.id || item.title}
                  title={item.title}
                  score={`${item.score}`}
                  summary={item.summary}
                />
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}