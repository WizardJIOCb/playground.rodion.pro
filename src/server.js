const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const express = require("express");
const httpProxy = require("http-proxy");
const { config } = require("./config");
const {
  createProject,
  ensureStorage,
  getProject,
  projectPaths,
  readProjects,
  sanitizePatch,
  updateProject,
  writeProjects
} = require("./store");
const {
  buildProject,
  cloneOrSync,
  deployProject,
  installProject,
  readLog,
  startProject,
  stopProject
} = require("./runner");

const app = express();
const proxy = httpProxy.createProxyServer({ xfwd: true, ws: true });
const PUBLIC_DIR = path.join(config.rootDir, "public");

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use("/assets", express.static(PUBLIC_DIR, { maxAge: "1h" }));

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAdmin(req, res, next) {
  if (!config.adminToken) return next();
  const token = req.get("x-admin-token") || req.query.token;
  if (token === config.adminToken) return next();
  return res.status(401).json({ error: "Нужен admin token." });
}

async function runAction(req, res, action) {
  const project = await getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: "Проект не найден." });
  const updated = await action(project);
  return res.json(updated);
}

app.get("/healthz", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/config", (req, res) => {
  res.json({
    authRequired: Boolean(config.adminToken),
    publicOrigin: config.publicOrigin
  });
});

app.get("/api/projects", asyncHandler(async (req, res) => {
  const projects = await readProjects();
  res.json(projects.sort((a, b) => a.slug.localeCompare(b.slug)));
}));

app.post("/api/projects", requireAdmin, asyncHandler(async (req, res) => {
  const projects = await readProjects();
  const project = createProject(req.body || {}, projects);
  projects.push(project);
  await writeProjects(projects);
  await fsp.mkdir(projectPaths(project.slug).baseDir, { recursive: true });
  res.status(201).json(project);
}));

app.get("/api/projects/:slug", asyncHandler(async (req, res) => {
  const project = await getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: "Проект не найден." });
  res.json(project);
}));

app.patch("/api/projects/:slug", requireAdmin, asyncHandler(async (req, res) => {
  const patch = sanitizePatch(req.body || {});
  const updated = await updateProject(req.params.slug, patch);
  res.json(updated);
}));

app.delete("/api/projects/:slug", requireAdmin, asyncHandler(async (req, res) => {
  const project = await getProject(req.params.slug);
  if (!project) return res.status(404).json({ error: "Проект не найден." });

  await stopProject(project, { quiet: true });
  const projects = (await readProjects()).filter((item) => item.slug !== req.params.slug);
  await writeProjects(projects);

  if (req.query.files === "1") {
    await fsp.rm(projectPaths(project.slug).baseDir, { recursive: true, force: true });
  }

  res.json({ ok: true });
}));

app.get("/api/projects/:slug/logs", asyncHandler(async (req, res) => {
  res.type("text/plain").send(await readLog(req.params.slug));
}));

app.post("/api/projects/:slug/sync", requireAdmin, asyncHandler((req, res) => runAction(req, res, cloneOrSync)));
app.post("/api/projects/:slug/install", requireAdmin, asyncHandler((req, res) => runAction(req, res, installProject)));
app.post("/api/projects/:slug/build", requireAdmin, asyncHandler((req, res) => runAction(req, res, buildProject)));
app.post("/api/projects/:slug/deploy", requireAdmin, asyncHandler((req, res) => runAction(req, res, deployProject)));
app.post("/api/projects/:slug/start", requireAdmin, asyncHandler((req, res) => runAction(req, res, startProject)));
app.post("/api/projects/:slug/stop", requireAdmin, asyncHandler((req, res) => runAction(req, res, stopProject)));

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use("/:slug", asyncHandler(async (req, res, next) => {
  const project = await getProject(req.params.slug);
  if (!project) return next();

  if (project.serveMode === "proxy") {
    if (!project.port) return res.status(503).send("Project proxy port is not configured.");

    const originalUrl = req.url;
    if (project.proxyStripPrefix === false) {
      req.url = req.url === "/" ? req.baseUrl : `${req.baseUrl}${req.url}`;
    }

    proxy.web(req, res, {
      target: `http://127.0.0.1:${project.port}`,
      changeOrigin: true
    }, (error) => {
      req.url = originalUrl;
      next(error);
    });
    return;
  }

  const paths = projectPaths(project.slug);
  const staticRoot = path.resolve(paths.repoDir, project.outputDir || "dist");
  const indexFile = path.join(staticRoot, "index.html");

  express.static(staticRoot, {
    extensions: ["html"],
    fallthrough: true
  })(req, res, async (error) => {
    if (error) return next(error);
    if (req.accepts("html") && fs.existsSync(indexFile)) {
      return res.sendFile(indexFile);
    }
    return next();
  });
}));

proxy.on("error", (error, req, res) => {
  if (!res.headersSent) {
    res.statusCode = 502;
    res.end(`Proxy error: ${error.message}`);
  }
});

app.use((req, res) => {
  res.status(404).send("Not found");
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message || "Internal server error" });
});

ensureStorage().then(() => {
  app.listen(config.port, config.host, () => {
    console.log(`playground listening on http://${config.host}:${config.port}`);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
