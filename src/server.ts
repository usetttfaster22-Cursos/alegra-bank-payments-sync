import "dotenv/config";
import express from "express";
import path from "node:path";
import { movementsRouter } from "./routes/movements";
import { alegraRouter } from "./routes/alegra";

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER;
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD;

if (BASIC_AUTH_USER && BASIC_AUTH_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Basic ")) {
      const [user, password] = Buffer.from(header.slice(6), "base64").toString().split(":");
      if (user === BASIC_AUTH_USER && password === BASIC_AUTH_PASSWORD) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="alegra-bank-payments-sync"');
    res.status(401).send("Autenticación requerida");
  });
} else {
  // eslint-disable-next-line no-console
  console.warn("[server] BASIC_AUTH_USER/BASIC_AUTH_PASSWORD no configurados: la pantalla web queda sin autenticación.");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api/movements", movementsRouter);
app.use("/api/alegra", alegraRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`alegra-bank-payments-sync escuchando en http://localhost:${PORT}`);
});
