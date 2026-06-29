import express from "express";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT || 3001);

app.disable("x-powered-by");
app.use(cors());
app.use(express.json());

app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.json({
    service: "webapp-backend",
    status: "ok",
    health: "/api/healthz",
  });
});

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`webapp-backend listening on ${port}`);
});
