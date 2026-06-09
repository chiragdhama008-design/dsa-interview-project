import express from "express";
import { generateQuestions, evaluateInterview } from "../controllers/interviewController.js";

const router = express.Router();

// 1. Generates the questions from resume text
router.post("/generate", generateQuestions);

// 2. NEW: Collects answers, saves them, and requests Gemini Feedback evaluation
router.post("/evaluate", evaluateInterview);

export default router;