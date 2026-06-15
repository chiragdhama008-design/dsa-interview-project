import {
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

export default function ScoreChart({ liveData = [] }) { // Added default empty array fallback
  return (
    <div className="bg-slate-900 rounded-2xl p-6 border border-slate-800">

      <h2 className="text-xl font-semibold mb-6">
        Score Trend
      </h2>

      <ResponsiveContainer
        width="100%"
        height={300}
      >
        <LineChart data={liveData}>
          <XAxis dataKey="day" stroke="#64748b" />
          <YAxis domain={[0, 100]} stroke="#64748b" />
          <Tooltip 
            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#c084fc" 
            strokeWidth={3}
            dot={{ fill: '#ffffff', stroke: '#c084fc', strokeWidth: 2 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>

    </div>
  );
}