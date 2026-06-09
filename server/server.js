import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";

import resumeRoutes from "./routes/resumeRoutes.js";
import interviewRoutes from "./routes/interviewRoutes.js";
import evaluationRoutes from "./routes/evaluationRoutes.js";

const app = express();

// Enable clean communications from your Vite client port structure
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// Main Root Endpoints Setup Gateway Matrix
app.use("/api/resume", resumeRoutes);
app.use("/api/interview", interviewRoutes);
app.use("/api/evaluation", evaluationRoutes);

app.get("/", (req, res) => {
  res.send("Backend Running");
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});