import { useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import HeroBanner from "../components/HeroBanner";
import StatCard from "../components/StatCard";
import InterviewCard from "../components/InterviewCard";
import ScoreChart from "../components/ScoreChart";
import { Loader2, Calendar, Award, Layers } from "lucide-react";

export default function Dashboard() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch data dynamically on mount
  useEffect(() => {
    const fetchDashboardMetrics = async () => {
      try {
        const response = await fetch("http://localhost:5000/api/interview/global-analytics");
        const json = await response.json();
        if (json.success) {
          setMetrics(json.metrics);
        }
      } catch (err) {
        console.error("Failed fetching live dashboard metrics:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardMetrics();
  }, []);

  // Display a clean loading indicator while communicating with the backend database
  if (loading) {
    return (
      <div className="flex min-h-screen bg-slate-950 text-white items-center justify-center">
        <Loader2 className="animate-spin text-purple-500" size={40} />
      </div>
    );
  }

  // Graceful fallback defaults if the database table runs empty
  const data = metrics || {
    totalInterviews: 0,
    averageScore: 0,
    skillsTestedCount: 0,
    recentInterviews: [],
    scoreTrend: []
  };

  // Convert real metrics into the format expected by your StatCard components
  const dynamicStats = [
    {
      title: "TOTAL INTERVIEWS",
      value: data.totalInterviews,
      icon: <Calendar size={20} className="text-purple-400" />,
    },
    {
      title: "AVERAGE SCORE",
      value: `${data.averageScore}%`,
      icon: <Award size={20} className="text-emerald-400" />,
    },
    {
      title: "SKILLS TESTED",
      value: data.skillsTestedCount,
      icon: <Layers size={20} className="text-cyan-400" />,
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
              icon={item.icon}
            />
          ))}
        </div>

        {/* Dynamic Score Curve Component */}
        <div className="mt-8">
          <ScoreChart data={data.scoreTrend} />
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
                  key={item.id}
                  title={item.title}
                  score={`${item.score}%`}
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