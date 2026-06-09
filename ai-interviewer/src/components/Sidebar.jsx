import {
  LayoutDashboard,
  FileText,
  Mic,
  BarChart3,
  Settings,
} from "lucide-react";

import { NavLink } from "react-router-dom";

export default function Sidebar() {
  const menuItems = [
    {
      name: "Dashboard",
      icon: <LayoutDashboard size={20} />,
      path: "/",
    },
    {
      name: "Resume",
      icon: <FileText size={20} />,
      path: "/resume",
    },
    {
      name: "Interviews",
      icon: <Mic size={20} />,
      path: "/interviews",
    },
    {
      name: "Analytics",
      icon: <BarChart3 size={20} />,
      path: "/analytics",
    },
    {
      name: "Settings",
      icon: <Settings size={20} />,
      path: "/settings",
    },
  ];

  return (
    <div className="w-72 min-h-screen bg-slate-950 border-r border-slate-800 p-6">

      <h1 className="text-3xl font-bold text-white mb-12">
        AI Interviewer
      </h1>

      <nav className="space-y-3">

        {menuItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 p-4 rounded-xl transition-all duration-300
              
              ${
                isActive
                  ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-lg shadow-purple-900/30"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`
            }
          >
            {item.icon}
            <span>{item.name}</span>
          </NavLink>
        ))}

      </nav>

      <div className="mt-auto pt-16">
        <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800">

          <p className="text-sm text-slate-400">
            AI Interview Score
          </p>

          <h2 className="text-3xl font-bold mt-2 text-white">
            82%
          </h2>

          <div className="w-full h-2 bg-slate-700 rounded-full mt-4">
            <div
              className="h-2 rounded-full bg-gradient-to-r from-purple-500 to-cyan-400"
              style={{ width: "82%" }}
            />
          </div>

        </div>
      </div>

    </div>
  );
}