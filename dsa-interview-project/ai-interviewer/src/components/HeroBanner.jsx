import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

export default function HeroBanner() {
  const navigate = useNavigate();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="
      rounded-3xl
      p-10
      bg-gradient-to-r
      from-purple-700
      via-fuchsia-600
      to-cyan-500"
    >
      <h1 className="text-5xl font-bold text-white">
        Practice Interviews
      </h1>

      <p className="text-white mt-4 text-lg">
        AI-powered mock interviews tailored to your resume.
      </p>

      <button
        onClick={() => navigate("/interviews")}
        className="
        mt-8
        px-6
        py-3
        rounded-xl
        bg-white
        text-black
        font-semibold
        hover:scale-105
        transition"
      >
        Start Interview
      </button>
    </motion.div>
  );
}