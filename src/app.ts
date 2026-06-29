import express from "express";
import cors from "cors";
import routes from "./routes/index.js";

const app = express();

app.disable("x-powered-by");
app.use(cors());
app.use(express.json());

app.use("/api", routes);

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: "Not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ ok: false, error: "Internal server error" });
});

export default app;
