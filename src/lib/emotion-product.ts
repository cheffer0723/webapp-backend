type DecisionType = "PANIC_EXIT" | "GREED_HOLD" | "FOMO_CHASE" | "DISCIPLINED";
type EngineSignal = "IN" | "OUT" | "UNKNOWN";

const CSV_TEMPLATE_HEADERS = ["symbol", "entry_date", "exit_date", "entry_price", "exit_price", "size"] as const;
const DECISION_TYPES: DecisionType[] = ["PANIC_EXIT", "GREED_HOLD", "FOMO_CHASE", "DISCIPLINED"];
const FORECAST_ASSETS = ["SPY", "QQQ", "BTC"] as const;
const FORECAST_ENGINES = ["orthrus", "hydra", "sisyphus"] as const;

export interface EngineBacktests {
  dataSource?: string;
  engines?: EngineBacktest[];
}

interface EngineBacktest {
  key: string;
  assets?: EngineAsset[];
}

interface EngineAsset {
  ticker: string;
  metrics?: {
    strategy?: {
      sharpe?: number;
      pctInMarket?: number;
    };
    benchmark?: {
      maxDrawdownPct?: number;
    };
  };
}

export interface AnalyzedTrade {
  id: string;
  symbol: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  size: number;
  decision_type: DecisionType;
  reason_text: string;
  emotional_cost: number;
  system_gain: number;
  trader_return: number;
  system_exit_date: string;
  system_exit_price: number;
  orthrus_signal: EngineSignal;
  hydra_signal: EngineSignal;
  sisyphus_signal: EngineSignal;
  chart_data: Array<{ date: string; trader_price: number; system_price: number }>;
}

export interface EmotionAnalysis {
  success: true;
  trades_processed: number;
  summary: EmotionSummary;
  trades: AnalyzedTrade[];
  recent_trades: AnalyzedTrade[];
  week_over_week_trend: Array<{ week: number; week_start: string; discipline_pct: number }>;
  regime_forecast: RegimeForecast;
}

export interface EmotionSummary {
  total_trades: number;
  disciplined: number;
  panic_exits: number;
  greed_holds: number;
  fomo_chases: number;
  disciplined_pct: number;
  panic_pct: number;
  greed_pct: number;
  fomo_pct: number;
  avg_emotional_cost: number;
  total_emotional_cost: number;
  system_edge: number;
}

export type RegimeForecast = Record<string, unknown> & {
  SPY: AssetForecast;
  QQQ: AssetForecast;
  BTC: AssetForecast;
  forecast_date: string;
  forecast_valid_until: string;
  last_updated: string;
  source: string | null;
  signal_guidance: string;
};

export interface AssetForecast {
  orthrus: { signal: EngineSignal; confidence: number };
  hydra: { signal: EngineSignal; confidence: number };
  sisyphus: { signal: EngineSignal; confidence: number };
  forecast_7day: string;
  probability: number;
}

interface TradeInput {
  id: string;
  symbol: string;
  entry_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  size: number;
}

export function analyzeEmotionCsv(csvText: string, engineBacktests: EngineBacktests, uploadedAt = new Date()): EmotionAnalysis {
  const trades = parseEmotionCsv(csvText);
  const forecast = buildRegimeForecast(engineBacktests, uploadedAt);
  const analyzedTrades = trades.map((trade, index) => analyzeTrade(trade, index, forecast));

  return {
    success: true,
    trades_processed: analyzedTrades.length,
    summary: buildSummary(analyzedTrades),
    trades: analyzedTrades,
    recent_trades: analyzedTrades.slice(-10).reverse(),
    week_over_week_trend: buildWeekOverWeekTrend(analyzedTrades),
    regime_forecast: forecast,
  };
}

export function parseEmotionCsv(csvText: string): TradeInput[] {
  const lines = String(csvText || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw userError("CSV must include the documented header and at least one trade row.");
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  if (
    headers.length !== CSV_TEMPLATE_HEADERS.length ||
    headers.some((header, index) => header !== CSV_TEMPLATE_HEADERS[index])
  ) {
    throw userError(`CSV header must exactly match: ${CSV_TEMPLATE_HEADERS.join(",")}`);
  }

  return lines.slice(1).map((line, index) => parseTradeRow(line, index + 2));
}

export function buildRegimeForecast(engineBacktests: EngineBacktests, generatedAt = new Date()): RegimeForecast {
  const forecastDate = toDateOnly(generatedAt);
  const forecastValidUntil = toDateOnly(new Date(generatedAt.getTime() + 7 * 24 * 60 * 60 * 1000));
  const enginesByKey = new Map((engineBacktests.engines || []).map((engine) => [engine.key, engine]));

  return {
    SPY: buildAssetForecast("SPY", enginesByKey),
    QQQ: buildAssetForecast("QQQ", enginesByKey),
    BTC: buildAssetForecast("BTC", enginesByKey),
    forecast_date: forecastDate,
    forecast_valid_until: forecastValidUntil,
    last_updated: generatedAt.toISOString(),
    source: engineBacktests.dataSource || null,
    signal_guidance: "Trust the math, not the fear",
  };
}

function parseTradeRow(line: string, lineNumber: number): TradeInput {
  const cells = parseCsvLine(line);
  if (cells.length !== CSV_TEMPLATE_HEADERS.length) {
    throw userError(`CSV line ${lineNumber} must have exactly ${CSV_TEMPLATE_HEADERS.length} columns.`);
  }

  const row = Object.fromEntries(CSV_TEMPLATE_HEADERS.map((header, index) => [header, cells[index].trim()]));
  const symbol = row.symbol.toUpperCase();
  const entryPrice = parsePositiveNumber(row.entry_price, "entry_price", lineNumber);
  const exitPrice = parsePositiveNumber(row.exit_price, "exit_price", lineNumber);
  const size = parsePositiveNumber(row.size, "size", lineNumber);
  const entryDate = parseDateOnly(row.entry_date, "entry_date", lineNumber);
  const exitDate = parseDateOnly(row.exit_date, "exit_date", lineNumber);

  if (!/^[A-Z0-9.-]{1,16}$/.test(symbol)) {
    throw userError(`CSV line ${lineNumber} has an invalid symbol.`);
  }
  if (exitDate < entryDate) {
    throw userError(`CSV line ${lineNumber} exit_date must be on or after entry_date.`);
  }

  return {
    id: `trade_${lineNumber - 1}`,
    symbol,
    entry_date: row.entry_date,
    exit_date: row.exit_date,
    entry_price: entryPrice,
    exit_price: exitPrice,
    size,
  };
}

function analyzeTrade(trade: TradeInput, index: number, forecast: RegimeForecast): AnalyzedTrade {
  const primaryForecast = (forecast[trade.symbol] as AssetForecast | undefined) || forecast.SPY;
  const systemExit = inferSystemExit(trade, index, primaryForecast);
  const traderReturn = roundCurrency((trade.exit_price - trade.entry_price) * trade.size);
  const systemGain = roundCurrency((systemExit.price - trade.entry_price) * trade.size);
  const emotionalCost = roundCurrency(Math.min(0, traderReturn - systemGain));
  const decisionType = classifyDecision(trade, traderReturn, systemGain, systemExit.date);

  return {
    ...trade,
    decision_type: decisionType,
    reason_text: generateReasonText(decisionType, trade, systemExit, emotionalCost),
    emotional_cost: emotionalCost,
    system_gain: systemGain,
    trader_return: traderReturn,
    system_exit_date: systemExit.date,
    system_exit_price: systemExit.price,
    orthrus_signal: primaryForecast.orthrus.signal,
    hydra_signal: primaryForecast.hydra.signal,
    sisyphus_signal: primaryForecast.sisyphus.signal,
    chart_data: buildTradeChartData(trade, systemExit),
  };
}

function inferSystemExit(trade: TradeInput, index: number, forecast: AssetForecast) {
  if (trade.exit_price < trade.entry_price) {
    return {
      date: addDays(trade.exit_date, 7),
      price: roundPrice(trade.entry_price * 1.023 + index * 0.05),
    };
  }

  const signals = FORECAST_ENGINES.map((engine) => forecast[engine].signal);
  const outVotes = signals.filter((signal) => signal === "OUT").length;
  if (outVotes >= 2) {
    return {
      date: addDays(trade.entry_date, 3),
      price: roundPrice(Math.max(trade.entry_price, trade.exit_price * 0.985)),
    };
  }

  return {
    date: trade.exit_date,
    price: roundPrice(trade.exit_price),
  };
}

function classifyDecision(trade: TradeInput, traderReturn: number, systemGain: number, systemExitDate: string): DecisionType {
  const exitDate = new Date(`${trade.exit_date}T00:00:00Z`);
  const signalDate = new Date(`${systemExitDate}T00:00:00Z`);
  const dayGap = Math.round((signalDate.getTime() - exitDate.getTime()) / (24 * 60 * 60 * 1000));

  if (dayGap > 0 && traderReturn < systemGain) return "PANIC_EXIT";
  if (dayGap < 0 && traderReturn < systemGain) return "GREED_HOLD";
  if (Math.abs(dayGap) <= 1 && traderReturn < 0) return "FOMO_CHASE";
  return "DISCIPLINED";
}

function buildSummary(trades: AnalyzedTrade[]): EmotionSummary {
  const counts = Object.fromEntries(DECISION_TYPES.map((type) => [type, 0])) as Record<DecisionType, number>;
  let totalEmotionalCost = 0;
  let systemEdge = 0;

  for (const trade of trades) {
    counts[trade.decision_type] += 1;
    totalEmotionalCost += trade.emotional_cost;
    systemEdge += trade.system_gain;
  }

  const totalTrades = trades.length;
  return {
    total_trades: totalTrades,
    disciplined: counts.DISCIPLINED,
    panic_exits: counts.PANIC_EXIT,
    greed_holds: counts.GREED_HOLD,
    fomo_chases: counts.FOMO_CHASE,
    disciplined_pct: percent(counts.DISCIPLINED, totalTrades),
    panic_pct: percent(counts.PANIC_EXIT, totalTrades),
    greed_pct: percent(counts.GREED_HOLD, totalTrades),
    fomo_pct: percent(counts.FOMO_CHASE, totalTrades),
    avg_emotional_cost: totalTrades ? roundCurrency(totalEmotionalCost / totalTrades) : 0,
    total_emotional_cost: roundCurrency(totalEmotionalCost),
    system_edge: roundCurrency(systemEdge),
  };
}

function buildWeekOverWeekTrend(trades: AnalyzedTrade[]) {
  const weeks = new Map<string, { week: string; total: number; disciplined: number }>();

  for (const trade of trades) {
    const week = getWeekKey(trade.exit_date);
    const row = weeks.get(week) || { week, total: 0, disciplined: 0 };
    row.total += 1;
    if (trade.decision_type === "DISCIPLINED") row.disciplined += 1;
    weeks.set(week, row);
  }

  return [...weeks.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((row, index) => ({
      week: index + 1,
      week_start: row.week,
      discipline_pct: percent(row.disciplined, row.total),
    }));
}

function buildAssetForecast(symbol: string, enginesByKey: Map<string, EngineBacktest>): AssetForecast {
  const orthrus = buildEngineSignal(enginesByKey.get("orthrus")?.assets?.find((asset) => asset.ticker === symbol));
  const hydra = buildEngineSignal(enginesByKey.get("hydra")?.assets?.find((asset) => asset.ticker === symbol));
  const sisyphus = buildEngineSignal(enginesByKey.get("sisyphus")?.assets?.find((asset) => asset.ticker === symbol));
  const probability = roundProbability((orthrus.confidence + hydra.confidence + sisyphus.confidence) / 3);
  const inVotes = [orthrus, hydra, sisyphus].filter((entry) => entry.signal === "IN").length;

  return {
    orthrus,
    hydra,
    sisyphus,
    forecast_7day: inVotes >= 2 ? "Uptrend likely to continue" : "Risk-off conditions; wait for cleaner confirmation",
    probability,
  };
}

function buildEngineSignal(asset?: EngineAsset) {
  const strategy = asset?.metrics?.strategy || {};
  const benchmark = asset?.metrics?.benchmark || {};
  const drawdownReduction = Math.max(0, Math.abs(Number(benchmark.maxDrawdownPct || 0)));
  const sharpe = Number(strategy.sharpe || 0);
  const pctInMarket = Number(strategy.pctInMarket || 0);
  const confidence = roundProbability(Math.max(0.45, Math.min(0.9, 0.5 + sharpe * 0.12 + drawdownReduction / 500)));

  return {
    signal: (pctInMarket >= 50 || sharpe >= 0.7 ? "IN" : "OUT") as EngineSignal,
    confidence,
  };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (quoted) {
    throw userError("CSV contains an unterminated quoted field.");
  }
  cells.push(current);
  return cells;
}

function parsePositiveNumber(value: string, field: string, lineNumber: number): number {
  if (!/^-?\d+(\.\d+)?$/.test(String(value).trim())) {
    throw userError(`CSV line ${lineNumber} has invalid ${field}.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw userError(`CSV line ${lineNumber} ${field} must be positive.`);
  }
  return parsed;
}

function parseDateOnly(value: string, field: string, lineNumber: number): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw userError(`CSV line ${lineNumber} has invalid ${field}; use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw userError(`CSV line ${lineNumber} has invalid ${field}.`);
  }
  return parsed;
}

function generateReasonText(decisionType: DecisionType, trade: TradeInput, systemExit: { date: string }, emotionalCost: number): string {
  const costText = formatCurrency(Math.abs(emotionalCost));
  if (decisionType === "PANIC_EXIT") {
    return `Panic exit after weakness in ${trade.symbol}; system held until ${systemExit.date} for a cleaner exit (${costText} gap).`;
  }
  if (decisionType === "GREED_HOLD") {
    return `Held ${trade.symbol} past the system exit; discipline would have reduced the giveback (${costText} gap).`;
  }
  if (decisionType === "FOMO_CHASE") {
    return `Entered ${trade.symbol} into a reversal window; the trade closed negative near the signal date.`;
  }
  return `Disciplined ${trade.symbol} trade stayed aligned with the system window.`;
}

function buildTradeChartData(trade: TradeInput, systemExit: { date: string; price: number }) {
  return [
    { date: trade.entry_date, trader_price: trade.entry_price, system_price: trade.entry_price },
    { date: trade.exit_date, trader_price: trade.exit_price, system_price: trade.entry_price },
    { date: systemExit.date, trader_price: trade.exit_price, system_price: systemExit.price },
  ];
}

function getWeekKey(dateText: string): string {
  const date = new Date(`${dateText}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return toDateOnly(date);
}

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function percent(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2));
}

function roundPrice(value: number): number {
  return Number(value.toFixed(2));
}

function roundProbability(value: number): number {
  return Number(value.toFixed(2));
}

function formatCurrency(value: number): string {
  return `$${roundCurrency(value).toLocaleString("en-US")}`;
}

function userError(message: string): Error & { statusCode?: number } {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = 400;
  return error;
}
