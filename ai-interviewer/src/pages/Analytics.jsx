import Sidebar from "../components/Sidebar";
import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  RadialBarChart,
  RadialBar,
} from "recharts";

import { motion } from "framer-motion";
import { Brain, Target, TrendingUp, Clock } from "lucide-react";

/* MOCK DATA (better visuals) */
const performanceData = [
  { name: "Mon", score: 55 },
  { name: "Tue", score: 70 },
  { name: "Wed", score: 65 },
  { name: "Thu", score: 85 },
  { name: "Fri", score: 90 },
  { name: "Sat", score: 95 },
  { name: "Sun", score: 88 },
];

const skillData = [
  { name: "DSA", value: 85, fill: "#3b82f6" },
  { name: "System", value: 72, fill: "#22c55e" },
  { name: "DBMS", value: 78, fill: "#f59e0b" },
  { name: "OS", value: 70, fill: "#ef4444" },
];

export default function Analytics() {
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white">

      {/* SIDEBAR */}
      <Sidebar />

      {/* MAIN */}
      <div className="flex-1 p-6 space-y-6">

        {/* HEADER */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-4xl font-bold">📊 Analytics Dashboard</h1>
          <p className="text-gray-400">
            AI-powered performance insights
          </p>
        </motion.div>

        {/* STATS */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

          {[
            { icon: Brain, label: "Interviews", value: 28 },
            { icon: Target, label: "Avg Score", value: "82%" },
            { icon: TrendingUp, label: "Growth", value: "+18%" },
            { icon: Clock, label: "Hours", value: "24h" },
          ].map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              className="
                p-5 rounded-2xl 
                bg-white/5 backdrop-blur-xl 
                border border-white/10 
                hover:scale-105 transition
              "
            >
              <item.icon className="text-blue-400 mb-2" />
              <p className="text-gray-400 text-sm">{item.label}</p>
              <h2 className="text-2xl font-bold">{item.value}</h2>
            </motion.div>
          ))}
        </div>

        {/* LINE CHART (GLASS + GRADIENT) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl"
        >
          <h2 className="text-xl font-semibold mb-4">
            Performance Curve
          </h2>

          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={performanceData}>
              <defs>
                <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>

              <XAxis dataKey="name" stroke="#aaa" />
              <YAxis stroke="#aaa" />
              <Tooltip />

              <Area
                type="monotone"
                dataKey="score"
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#colorScore)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* RADIAL SKILL CHART (LOOKS PREMIUM) */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl"
        >
          <h2 className="text-xl font-semibold mb-4">
            Skill Breakdown
          </h2>

          <div className="flex justify-center">
            <ResponsiveContainer width={400} height={300}>
              <RadialBarChart
                innerRadius="20%"
                outerRadius="100%"
                data={skillData}
              >
                <RadialBar
                  dataKey="value"
                  cornerRadius={10}
                />
                <Tooltip />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

      </div>
    </div>
  );
}