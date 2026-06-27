import React, { useState } from "react";
import Sidebar from "../components/Sidebar";
import { motion } from "framer-motion";
import { User, Bell, Shield, Palette } from "lucide-react";

export default function Settings() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    bio: "",
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-black via-gray-900 to-black text-white">

      {/* ✅ SIDEBAR FIXED */}
      <div className="w-64 fixed left-0 top-0 h-full border-r border-white/10 bg-black/40 backdrop-blur-xl">
        <Sidebar />
      </div>

      {/* MAIN CONTENT (OFFSET) */}
      <div className="flex-1 ml-64 p-8 space-y-8">

        {/* HEADER */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-2"
        >
          <h1 className="text-4xl font-bold bg-gradient-to-r from-white via-blue-400 to-purple-500 bg-clip-text text-transparent">
            ⚙️ Settings
          </h1>
          <p className="text-gray-400 mt-1">
            Manage your account & preferences
          </p>
        </motion.div>

        {/* OPTIONS GRID */}
        <div className="grid md:grid-cols-2 gap-6">

          {[
            { icon: User, title: "Profile", desc: "Edit your info", color: "blue" },
            { icon: Bell, title: "Notifications", desc: "Alerts & emails", color: "purple" },
            { icon: Shield, title: "Security", desc: "Password & login", color: "green" },
            { icon: Palette, title: "Theme", desc: "Dark / Light mode", color: "yellow" },
          ].map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              whileHover={{
                scale: 1.04,
                y: -5,
              }}
              className="
                relative p-6 rounded-2xl
                bg-white/5 backdrop-blur-xl
                border border-white/10
                hover:border-white/30
                transition-all duration-300
                shadow-lg shadow-black/40
                cursor-pointer
                overflow-hidden
              "
            >
              {/* glow effect */}
              <div className="absolute inset-0 opacity-0 hover:opacity-100 transition duration-500 bg-gradient-to-r from-transparent via-white/5 to-transparent" />

              <item.icon className="text-blue-400 mb-3" />

              <h2 className="text-xl font-semibold">{item.title}</h2>
              <p className="text-gray-400 text-sm mt-1">{item.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* FORM CARD */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="
            p-8 rounded-2xl
            bg-white/5 backdrop-blur-xl
            border border-white/10
            shadow-xl shadow-black/40
          "
        >
          <h2 className="text-2xl font-semibold mb-6">
            Edit Profile
          </h2>

          <div className="space-y-4">

            <input
              name="name"
              onChange={handleChange}
              placeholder="Name"
              className="
                w-full p-3 rounded-xl
                bg-black/60
                border border-white/10
                focus:border-blue-500
                outline-none
                transition
              "
            />

            <input
              name="email"
              onChange={handleChange}
              placeholder="Email"
              className="
                w-full p-3 rounded-xl
                bg-black/60
                border border-white/10
                focus:border-purple-500
                outline-none
                transition
              "
            />

            <textarea
              name="bio"
              onChange={handleChange}
              placeholder="Bio"
              className="
                w-full p-3 rounded-xl
                bg-black/60
                border border-white/10
                focus:border-green-500
                outline-none
                transition
                min-h-[120px]
              "
            />

            <button className="
              px-6 py-2 rounded-xl
              bg-gradient-to-r from-blue-500 to-purple-500
              hover:from-purple-500 hover:to-blue-500
              transition-all duration-300
              font-semibold
              shadow-lg shadow-blue-500/20
            ">
              Save Changes
            </button>

          </div>
        </motion.div>

      </div>
    </div>
  );
}