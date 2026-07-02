import { Router } from "express";
import emotionRouter from "./emotion.js";
import healthRouter from "./health.js";
import machineRouter from "./machine.js";

const router = Router();

router.use(healthRouter);
router.use(emotionRouter);
router.use(machineRouter);

export default router;
