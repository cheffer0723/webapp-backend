import fs from "fs";
import path from "path";
import { Router } from "express";
import type { EngineBacktests } from "../lib/emotion-product.js";
import { buildHexagonReview, resolveProvider } from "../lib/hexagon.js";

const engineDataPath = path.resolve(process.cwd(), "data/backtests/engines.json");
function loadEngineBacktests(): EngineBacktests {
  return JSON.parse(fs.readFileSync(engineDataPath, "utf8")) as EngineBacktests;
}
function getCsv(body: unknown): string {
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const b = body as { csv?: unknown; content?: unknown };
    if (typeof b.csv === "string") return b.csv;
    if (typeof b.content === "string") return b.content;
  }
  return "";
}

const router = Router();

// Discovery: is the live council wired (real LLM) or preview (mock)?
router.get("/hexagon/status", (_req, res) => {
  const { mode } = resolveProvider();
  res.json({ ok: true, council: "The Hexagon", seats: 6, mode });
});

// Convene the council on an uploaded trades CSV. Returns { review } in the fixed contract.
router.post("/hexagon/review", async (req, res, next) => {
  try {
    const csv = getCsv(req.body);
    if (!csv.trim()) { res.status(400).json({ ok: false, error: "No CSV provided" }); return; }
    const { provider, mode } = resolveProvider();
    const review = await buildHexagonReview(csv, loadEngineBacktests(), provider);
    res.json({ ok: true, mode, review });
  } catch (error) {
    next(error);
  }
});

export default router;
