import { Router } from "express";
import emotionRouter from "./emotion.js";
import healthRouter from "./health.js";
import machineRouter from "./machine.js";
import hexagonRouter from "./hexagon.js";

const router = Router();

router.use(healthRouter);
router.use(emotionRouter);
router.use(machineRouter);
router.use(hexagonRouter);

export default router;
