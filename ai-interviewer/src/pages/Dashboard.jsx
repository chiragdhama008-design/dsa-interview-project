import Sidebar from "../components/Sidebar";
import HeroBanner from "../components/HeroBanner";
import StatCard from "../components/StatCard";
import InterviewCard from "../components/InterviewCard";
import ScoreChart from "../components/ScoreChart";

import {
  stats,
  interviews,
} from "../data/dummyData";

export default function Dashboard() {
  return (
    <div className="flex bg-slate-950 text-white min-h-screen">

      <Sidebar />

      <div className="flex-1 p-8">

        <HeroBanner />

        <div className="grid grid-cols-3 gap-6 mt-8">

          {stats.map((item) => (
            <StatCard
              key={item.title}
              {...item}
            />
          ))}

        </div>

        <div className="mt-8">
          <ScoreChart />
        </div>

        <div className="mt-8">

          <h2 className="text-2xl font-bold mb-4">
            Recent Interviews
          </h2>

          <div className="grid grid-cols-3 gap-4">

            {interviews.map((item) => (
              <InterviewCard
                key={item.title}
                {...item}
              />
            ))}

          </div>

        </div>

      </div>

    </div>
  );
}