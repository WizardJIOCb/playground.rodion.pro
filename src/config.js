const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

function resolveFromRoot(value, fallback) {
  return path.resolve(ROOT_DIR, value || fallback);
}

const config = {
  rootDir: ROOT_DIR,
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  publicOrigin: process.env.PUBLIC_ORIGIN || "http://localhost:3000",
  adminToken: process.env.PLAYGROUND_ADMIN_TOKEN || "",
  dataDir: resolveFromRoot(process.env.DATA_DIR, "data"),
  projectsDir: resolveFromRoot(process.env.PROJECTS_DIR, "projects")
};

module.exports = { config };
