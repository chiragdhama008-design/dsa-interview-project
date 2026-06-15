import express from "express";
import { 
  generateQuestions, 
  generateTopicQuestions, 
  evaluateInterview 
} from "../controllers/interviewController.js";
import { getUserAnalyticsData } from "../controllers/analyticsController.js";

// 1. Initialize the router instance FIRST before mapping endpoints
const router = express.Router();

// 2. Global Performance & Metrics Paths (Feeds Dashboard, Analytics, and Sidebar Card Widgets)
router.get("/global-analytics", getUserAnalyticsData);

// 3. Interview Setup & Processing Pipeline Core Configurations
// Generates questions from uploaded resume text content
router.post("/generate", generateQuestions);

// Generates 10 specialized domain topic questions from selection dashboard configurations
router.post("/generate-topic", generateTopicQuestions);

// Collects answers, saves them, and requests Gemini Feedback evaluation
router.post("/evaluate", evaluateInterview);

export default router;