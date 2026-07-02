import fs from "fs";
import path from "path";
import { Router } from "express";
import { buildRegimeForecast, type EngineBacktests } from "../lib/emotion-product.js";
import { getX402Status } from "../lib/x402.js";

const engineDataPath = path.resolve(process.cwd(), "data/backtests/engines.json");

function loadEngineBacktests(): EngineBacktests {
  return JSON.parse(fs.readFileSync(engineDataPath, "utf8")) as EngineBacktests;
}

const router = Router();

// Free discovery endpoint: lets an agent see whether the paid surface is live and its terms.
router.get("/machine/status", (_req, res) => {
  res.json({ ok: true, surface: "agentic-access", status: getX402Status() });
});

// Paid route. When X402_ENABLED=true the x402 middleware gates this with a 402 challenge;
// when disabled it responds free. Human app endpoints are unaffected either way.
router.get("/machine/backtesting", (_req, res, next) => {
  try {
    res.json({
      ok: true,
      mode: "agent",
      surface: "agentic-access",
      generatedAt: new Date().toISOString(),
      forecast: buildRegimeForecast(loadEngineBacktests()),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
