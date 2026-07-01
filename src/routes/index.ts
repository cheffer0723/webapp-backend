import { Router } from "express";
import emotionRouter from "./emotion.js";
import healthRouter from "./health.js";

const router = Router();

router.use(healthRouter);
router.use(emotionRouter);

export default router;
