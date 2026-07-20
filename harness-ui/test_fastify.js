import Fastify from "fastify";
const app = Fastify();

app.addHook("onRequest", async (req, reply) => {
  console.log("Hook req.url:", req.url);
  if (!req.url.startsWith("/api/")) return; // Bypass auth
  req.isAuthed = true;
});

app.get("/api/health", async (req, reply) => {
  return { authed: req.isAuthed === true, url: req.url };
});

async function run() {
  const urls = [
    "/api/health",
    "//api/health",
    "/%61pi/health",
    "/API/health",
    "/api/health?foo=bar",
    "/api/health/../health"
  ];
  
  for (const u of urls) {
    const res = await app.inject({ method: "GET", url: u });
    console.log(`GET ${u} -> HTTP ${res.statusCode} ${res.payload}`);
  }
}

run();
