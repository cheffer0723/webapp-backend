import { analyzeEmotionCsv, type AnalyzedTrade, type EmotionAnalysis, type EngineBacktests } from "./emotion-product.js";

// ----- Fixed output contract (matches the frontend Hexagon component) -----
export type AgentVerdict = "mistake" | "defensible";

export interface HexagonAgent {
  id: string;
  name: string;
  verdict: AgentVerdict;
  text: string;
}

export interface HexagonReview {
  trade: {
    symbol: string; entryDate: string; exitDate: string;
    entryPrice: number; exitPrice: number; size: number;
    pnl: number; pnlPct: number;
  };
  agents: HexagonAgent[]; // exactly 6, in display order
  verdict: {
    decision: string;
    consensusMistake: number;
    consensusDefensible: number;
    userOutcome: number;
    councilOutcome: number;
    decisionCost: number;
    heldToDate: string;
    summary: string;
  };
  patternFlag: string;
}

// ----- The six seats -----
interface Role { id: string; name: string; lens: string }
export const ROLES: Role[] = [
  { id: "risk_manager", name: "Risk Manager",
    lens: "position sizing, stop discipline, and whether the exit was a defined rule or a discretionary flinch" },
  { id: "quant", name: "Quant",
    lens: "the statistical size of the move (ATR/noise) and whether the data gave any signal to act" },
  { id: "behavioral", name: "Behavioral Psych",
    lens: "emotional patterns - panic, FOMO, greed, revenge - and whether the exit tracked price pain instead of a plan" },
  { id: "contrarian", name: "Contrarian",
    lens: "crowd positioning - whether the trader followed the herd's flinch or had a genuine edge" },
  { id: "regime", name: "Regime Analyst - Cerberus",
    lens: "the market regime at the time (trend/momentum/mean-reversion signals) and whether the decision fought or followed it" },
  { id: "devils_advocate", name: "Devil's Advocate",
    lens: "the strongest honest defense of what the trader actually did (liquidity needs, leverage elsewhere, risk tolerance)" },
];

// A provider turns (role, context) into that role's verdict + take. Swappable: real LLM or mock.
export type AgentProvider = (role: Role, context: string) => Promise<{ verdict: AgentVerdict; text: string }>;

const DECISION_LABEL: Record<string, string> = {
  PANIC_EXIT: "HOLD",
  GREED_HOLD: "TAKE PROFIT",
  FOMO_CHASE: "STAND DOWN",
  DISCIPLINED: "AFFIRMED",
};
const DECISION_READABLE: Record<string, string> = {
  PANIC_EXIT: "discomfort-driven exit",
  GREED_HOLD: "greed hold",
  FOMO_CHASE: "FOMO chase",
  DISCIPLINED: "disciplined call",
};

function round(n: number, d = 0): number { const f = 10 ** d; return Math.round(n * f) / f; }

function buildContext(t: AnalyzedTrade): string {
  const gap = round(t.system_gain - t.trader_return);
  return [
    `Trade under review: ${t.symbol}`,
    `Bought ${t.entry_date} @ $${t.entry_price}, sold ${t.exit_date} @ $${t.exit_price}, size ${t.size}.`,
    `The trader's decision was classified as: ${t.decision_type}.`,
    `Trader's realized result: $${round(t.trader_return)}.`,
    `The disciplined/system path held to ${t.system_exit_date} @ $${t.system_exit_price} for $${round(t.system_gain)}.`,
    `Dollar gap between the two: $${gap}.`,
    `Regime signals at the time - Orthrus ${t.orthrus_signal}, Hydra ${t.hydra_signal}, Sisyphus ${t.sisyphus_signal}.`,
    `Judge ONLY through your lens: ${'{lens}'}.`,
  ].join("\n");
}

// Pick the single most instructive decision (largest dollar gap) to convene on.
function pickTrade(a: EmotionAnalysis): AnalyzedTrade {
  const trades = a.trades && a.trades.length ? a.trades : a.recent_trades;
  return [...trades].sort((x, y) => Math.abs(y.emotional_cost) - Math.abs(x.emotional_cost))[0];
}

export async function reviewTrade(t: AnalyzedTrade, provider: AgentProvider, wholeAnalysis?: EmotionAnalysis): Promise<HexagonReview> {
  const ctxBase = buildContext(t);
  // Run all six seats. Any failure rejects loudly (never a silent null).
  const agents: HexagonAgent[] = await Promise.all(
    ROLES.map(async (role): Promise<HexagonAgent> => {
      const out = await provider(role, ctxBase.replace("{lens}", role.lens));
      const verdict: AgentVerdict = out.verdict === "defensible" ? "defensible" : "mistake";
      const text = (out.text || "").trim();
      if (!text) throw new Error(`Agent ${role.id} returned empty text`);
      return { id: role.id, name: role.name, verdict, text };
    }),
  );

  const mistakeCount = agents.filter((a) => a.verdict === "mistake").length;
  const defensibleCount = agents.length - mistakeCount;
  const gap = round(t.system_gain - t.trader_return);

  // pattern flag across the whole upload
  let patternFlag = `1 of 1 reviewed = ${DECISION_READABLE[t.decision_type] || t.decision_type}. Watch for repeat.`;
  if (wholeAnalysis) {
    const total = (wholeAnalysis.trades || []).length || wholeAnalysis.trades_processed || 1;
    const same = (wholeAnalysis.trades || []).filter((x) => x.decision_type === t.decision_type).length || 1;
    patternFlag = `${same} of ${total} reviewed = ${DECISION_READABLE[t.decision_type] || t.decision_type}. Watch for repeat.`;
  }

  return {
    trade: {
      symbol: t.symbol, entryDate: t.entry_date, exitDate: t.exit_date,
      entryPrice: t.entry_price, exitPrice: t.exit_price, size: t.size,
      pnl: round((t.exit_price - t.entry_price) * t.size),
      pnlPct: round(((t.exit_price / t.entry_price) - 1) * 100, 1),
    },
    agents,
    verdict: {
      decision: DECISION_LABEL[t.decision_type] || "REVIEW",
      consensusMistake: mistakeCount,
      consensusDefensible: defensibleCount,
      userOutcome: round(t.trader_return),
      councilOutcome: round(t.system_gain),
      decisionCost: gap,
      heldToDate: t.system_exit_date,
      summary: `Consensus ${mistakeCount}-${defensibleCount}: ${DECISION_READABLE[t.decision_type] || "the decision"} `
        + `against the regime. The disciplined path to ${t.system_exit_date} turned $${round(t.trader_return)} into $${round(t.system_gain)}.`,
    },
    patternFlag,
  };
}

export async function buildHexagonReview(csvText: string, engineData: EngineBacktests, provider: AgentProvider): Promise<HexagonReview> {
  const analysis = analyzeEmotionCsv(csvText, engineData);
  if (!analysis.trades || analysis.trades.length === 0) throw new Error("No trades parsed from CSV");
  const trade = pickTrade(analysis);
  return reviewTrade(trade, provider, analysis);
}

// ----- Providers -----

// Mock: deterministic, keyless. Proves the plumbing + shape without an LLM. Never used in prod.
export const mockProvider: AgentProvider = async (role, context) => {
  const disciplined = /classified as: DISCIPLINED/.test(context);
  const verdict: AgentVerdict = disciplined
    ? "defensible"
    : role.id === "devils_advocate" ? "defensible" : "mistake";
  const text = verdict === "defensible"
    ? `[${role.name}] Through the lens of ${role.lens.split(" and ")[0]}, there is a defensible case here.`
    : `[${role.name}] Through the lens of ${role.lens.split(" and ")[0]}, this reads as an avoidable error against the setup.`;
  return { verdict, text };
};

// Real: one LLM call per seat (Anthropic). Requires ANTHROPIC_API_KEY. Fails loudly, never nulls.
export function anthropicProvider(): AgentProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ADVISOR_MODEL || "claude-haiku-4-5";
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return async (role, context) => {
    const system = `You are the "${role.name}" seat on a six-member trading review council called The Hexagon. `
      + `You review a trader's past decision through exactly one lens: ${role.lens}. `
      + `Be cold, clinical, and forensic. Do NOT preach, moralize, or scold. `
      + `Return ONLY minified JSON: {"verdict":"mistake"|"defensible","text":"<=2 sentences"}. `
      + `verdict="mistake" if the decision was an error through your lens, "defensible" if it was justified.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 300, system, messages: [{ role: "user", content: context }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status} for ${role.id}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    const raw = (data?.content?.[0]?.text || "").trim();
    let parsed: any; try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) {
      throw new Error(`Agent ${role.id} returned unparseable/empty output: ${raw.slice(0, 160)}`);
    }
    return { verdict: parsed.verdict === "defensible" ? "defensible" : "mistake", text: parsed.text.trim() };
  };
}

// Shared council system prompt (used by every real provider).
function councilSystemPrompt(role: Role): string {
  return `You are the "${role.name}" seat on a six-member trading review council called The Hexagon. `
    + `You review a trader's past decision through exactly one lens: ${role.lens}. `
    + `Be cold, clinical, and forensic. Do NOT preach, moralize, or scold. `
    + `Return ONLY minified JSON: {"verdict":"mistake"|"defensible","text":"<=2 sentences"}. `
    + `verdict="mistake" if the decision was an error through your lens, "defensible" if it was justified.`;
}

// DeepSeek (OpenAI-compatible). Cheap - preferred for the 6-call council. Requires DEEPSEEK_API_KEY.
export function deepseekProvider(): AgentProvider {
  const key = process.env.DEEPSEEK_API_KEY;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  if (!key) throw new Error("DEEPSEEK_API_KEY not set");
  return async (role, context) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 300, temperature: 0.5, response_format: { type: "json_object" },
        messages: [{ role: "system", content: councilSystemPrompt(role) }, { role: "user", content: context }],
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status} for ${role.id}: ${(await res.text()).slice(0, 200)}`);
    const data: any = await res.json();
    const raw = (data?.choices?.[0]?.message?.content || "").trim();
    let parsed: any; try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) {
      throw new Error(`Agent ${role.id} returned unparseable/empty output: ${raw.slice(0, 160)}`);
    }
    return { verdict: parsed.verdict === "defensible" ? "defensible" : "mistake", text: parsed.text.trim() };
  };
}

// Picks the provider from whatever key is configured. DeepSeek preferred, Anthropic fallback, else mock preview.
export function resolveProvider(): { provider: AgentProvider; mode: string } {
  if (process.env.DEEPSEEK_API_KEY) return { provider: deepseekProvider(), mode: "live:deepseek" };
  if (process.env.ANTHROPIC_API_KEY) return { provider: anthropicProvider(), mode: "live:anthropic" };
  return { provider: mockProvider, mode: "preview" };
}

// Loud validation used by the smoke test - no field may be null/empty.
export function assertReviewComplete(r: HexagonReview): void {
  const bad: string[] = [];
  if (!r.trade || !r.trade.symbol) bad.push("trade.symbol");
  if (!Array.isArray(r.agents) || r.agents.length !== 6) bad.push(`agents(count=${r.agents?.length})`);
  r.agents?.forEach((a, i) => {
    if (!a.id) bad.push(`agents[${i}].id`);
    if (!a.name) bad.push(`agents[${i}].name`);
    if (a.verdict !== "mistake" && a.verdict !== "defensible") bad.push(`agents[${i}].verdict`);
    if (!a.text || !a.text.trim()) bad.push(`agents[${i}].text`);
  });
  const v = r.verdict;
  ["decision", "heldToDate", "summary"].forEach((k) => { if (!(v as any)[k]) bad.push(`verdict.${k}`); });
  ["consensusMistake", "consensusDefensible", "userOutcome", "councilOutcome", "decisionCost"].forEach((k) => {
    if (typeof (v as any)[k] !== "number" || Number.isNaN((v as any)[k])) bad.push(`verdict.${k}`);
  });
  if (!r.patternFlag) bad.push("patternFlag");
  if (bad.length) throw new Error("Hexagon review incomplete - null/invalid fields: " + bad.join(", "));
}
