import app from "./app.js";

const rawPort = process.env.PORT || "3001";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`webapp-backend listening on ${port}`);
});
