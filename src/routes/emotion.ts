import fs from "fs";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import {
  analyzeEmotionCsv,
  buildRegimeForecast,
  type EmotionAnalysis,
  type EngineBacktests,
} from "../lib/emotion-product.js";

const engineDataPath = path.resolve(process.cwd(), "data/backtests/engines.json");
const uploadStore = new Map<string, { analysis: EmotionAnalysis; uploadedAt: string }>();

const summaryQuerySchema = z.object({
  period: z.enum(["week", "month", "all"]).optional().default("all"),
});

const recentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

const router = Router();

router.get(["/regime-forecast", "/beta/regime-forecast"], (_req, res, next) => {
  try {
    res.json(buildRegimeForecast(loadEngineBacktests()));
  } catch (error) {
    next(error);
  }
});

router.post(["/emotional-decisions/upload", "/beta/emotional-decisions/upload"], (req, res, next) => {
  try {
    const csvText = getCsvText(req.body);
    const analysis = analyzeEmotionCsv(csvText, loadEngineBacktests());
    const userId = getUserId(req);
    uploadStore.set(userId, {
      analysis,
      uploadedAt: new Date().toISOString(),
    });

    res.json(analysis);
  } catch (error) {
    next(error);
  }
});

router.get(["/emotional-decisions/summary", "/beta/emotional-decisions/summary"], (req, res, next) => {
  try {
    summaryQuerySchema.parse(req.query);
    const stored = uploadStore.get(getUserId(req));
    if (!stored) {
      res.json({
        total_trades: 0,
        disciplined_pct: 0,
        panic_pct: 0,
        greed_pct: 0,
        fomo_pct: 0,
        avg_emotional_cost: 0,
        total_emotional_cost: 0,
        system_edge: 0,
        week_over_week_trend: [],
      });
      return;
    }

    res.json({
      ...stored.analysis.summary,
      week_over_week_trend: stored.analysis.week_over_week_trend,
      uploaded_at: stored.uploadedAt,
    });
  } catch (error) {
    next(error);
  }
});

router.get(["/emotional-decisions/recent", "/beta/emotional-decisions/recent"], (req, res, next) => {
  try {
    const { limit } = recentQuerySchema.parse(req.query);
    const stored = uploadStore.get(getUserId(req));
    res.json(stored ? stored.analysis.recent_trades.slice(0, limit) : []);
  } catch (error) {
    next(error);
  }
});

function getCsvText(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (body && typeof body === "object") {
    const candidate = body as { csv?: unknown; content?: unknown };
    if (typeof candidate.csv === "string") return candidate.csv;
    if (typeof candidate.content === "string") return candidate.content;
  }
  return "";
}

function getUserId(req: { get(name: string): string | undefined }): string {
  return String(req.get("x-user-id") || "demo-user");
}

function loadEngineBacktests(): EngineBacktests {
  return JSON.parse(fs.readFileSync(engineDataPath, "utf8")) as EngineBacktests;
}

export default router;
