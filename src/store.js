const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { config } = require("./config");

const PROJECTS_FILE = path.join(config.dataDir, "projects.json");
const RESERVED_SLUGS = new Set([
  "api",
  "assets",
  "admin",
  "healthz",
  "favicon.ico",
  "robots.txt"
]);

async function ensureStorage() {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.mkdir(config.projectsDir, { recursive: true });

  try {
    await fs.access(PROJECTS_FILE);
  } catch {
    await fs.writeFile(PROJECTS_FILE, "[]\n", "utf8");
  }
}

async function readProjects() {
  await ensureStorage();
  const raw = await fs.readFile(PROJECTS_FILE, "utf8");
  return JSON.parse(raw || "[]");
}

async function writeProjects(projects) {
  await ensureStorage();
  const tmp = `${PROJECTS_FILE}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
  await fs.rename(tmp, PROJECTS_FILE);
}

function normalizeSlug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function validateSlug(slug) {
  if (!slug || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    throw Object.assign(new Error("Slug должен содержать 1-63 символа: a-z, 0-9 и дефисы."), { status: 400 });
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw Object.assign(new Error(`Slug "${slug}" зарезервирован системой.`), { status: 400 });
  }
}

function projectPaths(slug) {
  const baseDir = path.join(config.projectsDir, slug);
  return {
    baseDir,
    repoDir: path.join(baseDir, "repo"),
    logFile: path.join(baseDir, "deploy.log")
  };
}

function assertInsideProjects(targetPath) {
  const root = path.resolve(config.projectsDir);
  const resolved = path.resolve(targetPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes projects directory: ${resolved}`);
  }
  return resolved;
}

function now() {
  return new Date().toISOString();
}

function createProject(payload, existing) {
  const name = String(payload.name || "").trim();
  const slug = normalizeSlug(payload.slug || name);
  validateSlug(slug);

  if (!name) {
    throw Object.assign(new Error("Название проекта обязательно."), { status: 400 });
  }
  if (existing.some((project) => project.slug === slug)) {
    throw Object.assign(new Error(`Проект со slug "${slug}" уже существует.`), { status: 409 });
  }

  const createdAt = now();
  return {
    id: crypto.randomUUID(),
    name,
    slug,
    description: "",
    githubRepo: "",
    branch: "main",
    installCommand: "npm install",
    buildCommand: "npm run build",
    outputDir: "dist",
    serveMode: "static",
    startCommand: "npm start",
    port: "",
    proxyStripPrefix: true,
    envText: "",
    status: "created",
    lastAction: "",
    lastError: "",
    pid: null,
    createdAt,
    updatedAt: createdAt
  };
}

function sanitizePatch(payload) {
  const allowed = [
    "name",
    "description",
    "githubRepo",
    "branch",
    "installCommand",
    "buildCommand",
    "outputDir",
    "serveMode",
    "startCommand",
    "port",
    "proxyStripPrefix",
    "envText"
  ];
  const patch = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      patch[key] = payload[key];
    }
  }

  if (patch.name !== undefined) patch.name = String(patch.name).trim();
  if (patch.githubRepo !== undefined) patch.githubRepo = String(patch.githubRepo).trim();
  if (patch.branch !== undefined) patch.branch = String(patch.branch || "main").trim();
  if (patch.outputDir !== undefined) patch.outputDir = String(patch.outputDir || "dist").trim();
  if (patch.serveMode !== undefined && !["static", "proxy"].includes(patch.serveMode)) {
    throw Object.assign(new Error("serveMode должен быть static или proxy."), { status: 400 });
  }
  if (patch.port !== undefined) {
    patch.port = String(patch.port || "").trim();
    if (patch.port && !/^\d{2,5}$/.test(patch.port)) {
      throw Object.assign(new Error("Порт должен быть числом."), { status: 400 });
    }
  }
  if (patch.proxyStripPrefix !== undefined) patch.proxyStripPrefix = Boolean(patch.proxyStripPrefix);

  return patch;
}

async function getProject(slug) {
  const projects = await readProjects();
  return projects.find((project) => project.slug === slug) || null;
}

async function updateProject(slug, updater) {
  const projects = await readProjects();
  const index = projects.findIndex((project) => project.slug === slug);
  if (index === -1) {
    throw Object.assign(new Error("Проект не найден."), { status: 404 });
  }
  const updated = {
    ...projects[index],
    ...(typeof updater === "function" ? updater(projects[index]) : updater),
    updatedAt: now()
  };
  projects[index] = updated;
  await writeProjects(projects);
  return updated;
}

module.exports = {
  RESERVED_SLUGS,
  assertInsideProjects,
  createProject,
  ensureStorage,
  getProject,
  normalizeSlug,
  projectPaths,
  readProjects,
  sanitizePatch,
  updateProject,
  validateSlug,
  writeProjects
};
