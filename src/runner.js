const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const { config } = require("./config");
const { assertInsideProjects, projectPaths, updateProject } = require("./store");

function parseEnvText(text) {
  const env = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1);
  }
  return env;
}

async function ensureProjectDirs(slug) {
  const paths = projectPaths(slug);
  await fsp.mkdir(paths.baseDir, { recursive: true });
  return paths;
}

async function appendLog(slug, message) {
  const paths = await ensureProjectDirs(slug);
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fsp.appendFile(paths.logFile, line, "utf8");
}

async function readLog(slug) {
  const paths = projectPaths(slug);
  try {
    return await fsp.readFile(paths.logFile, "utf8");
  } catch {
    return "";
  }
}

function spawnCommand(project, command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...parseEnvText(project.envText),
        PUBLIC_ORIGIN: config.publicOrigin,
        PLAYGROUND_SLUG: project.slug,
        PLAYGROUND_BASE_PATH: `/${project.slug}/`
      },
      shell: true,
      windowsHide: true
    });

    child.stdout.on("data", (chunk) => appendLog(project.slug, chunk.toString().trimEnd()));
    child.stderr.on("data", (chunk) => appendLog(project.slug, chunk.toString().trimEnd()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`Команда завершилась с кодом ${code}: ${command}`), { exitCode: code }));
    });
  });
}

function spawnGit(project, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      windowsHide: true
    });

    child.stdout.on("data", (chunk) => appendLog(project.slug, chunk.toString().trimEnd()));
    child.stderr.on("data", (chunk) => appendLog(project.slug, chunk.toString().trimEnd()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`git ${args.join(" ")} завершился с кодом ${code}`), { exitCode: code }));
    });
  });
}

async function mark(project, status, lastAction, extra = {}) {
  return updateProject(project.slug, {
    status,
    lastAction,
    lastError: "",
    ...extra
  });
}

async function fail(project, action, error) {
  await appendLog(project.slug, `ERROR: ${error.message}`);
  await updateProject(project.slug, {
    status: "error",
    lastAction: action,
    lastError: error.message
  });
  throw error;
}

async function cloneOrSync(project) {
  if (!project.githubRepo) {
    throw Object.assign(new Error("У проекта не указана GitHub repo URL."), { status: 400 });
  }

  const paths = await ensureProjectDirs(project.slug);
  assertInsideProjects(paths.repoDir);
  await appendLog(project.slug, `=== sync ${project.githubRepo}#${project.branch || "main"} ===`);
  await mark(project, "running", "sync");

  try {
    const gitDir = path.join(paths.repoDir, ".git");
    if (fs.existsSync(gitDir)) {
      await spawnGit(project, ["remote", "set-url", "origin", project.githubRepo], paths.repoDir);
      await spawnGit(project, ["fetch", "--prune", "origin", project.branch || "main"], paths.repoDir);
      await spawnGit(project, ["checkout", project.branch || "main"], paths.repoDir);
      await spawnGit(project, ["reset", "--hard", `origin/${project.branch || "main"}`], paths.repoDir);
    } else {
      await fsp.rm(paths.repoDir, { recursive: true, force: true });
      await spawnGit(project, ["clone", "--branch", project.branch || "main", project.githubRepo, paths.repoDir], paths.baseDir);
    }
    return mark(project, "synced", "sync");
  } catch (error) {
    return fail(project, "sync", error);
  }
}

async function installProject(project) {
  const paths = projectPaths(project.slug);
  assertInsideProjects(paths.repoDir);
  if (!project.installCommand) return project;

  await appendLog(project.slug, `=== install: ${project.installCommand} ===`);
  await mark(project, "running", "install");

  try {
    await spawnCommand(project, project.installCommand, { cwd: paths.repoDir });
    return mark(project, "installed", "install");
  } catch (error) {
    return fail(project, "install", error);
  }
}

async function buildProject(project) {
  const paths = projectPaths(project.slug);
  assertInsideProjects(paths.repoDir);
  if (!project.buildCommand) return project;

  await appendLog(project.slug, `=== build: ${project.buildCommand} ===`);
  await mark(project, "running", "build");

  try {
    await spawnCommand(project, project.buildCommand, { cwd: paths.repoDir });
    return mark(project, "built", "build");
  } catch (error) {
    return fail(project, "build", error);
  }
}

async function deployProject(project) {
  let current = await cloneOrSync(project);
  current = await installProject(current);
  current = await buildProject(current);

  if (current.serveMode === "proxy" && current.startCommand) {
    current = await startProject(current);
  } else {
    current = await mark(current, "deployed", "deploy");
  }

  await appendLog(project.slug, "=== deploy complete ===");
  return current;
}

async function startProject(project) {
  if (!project.port) {
    throw Object.assign(new Error("Для proxy режима нужно указать порт."), { status: 400 });
  }
  if (!project.startCommand) {
    throw Object.assign(new Error("Для proxy режима нужна start command."), { status: 400 });
  }

  await stopProject(project, { quiet: true });

  const paths = await ensureProjectDirs(project.slug);
  const logFd = fs.openSync(paths.logFile, "a");
  await appendLog(project.slug, `=== start: ${project.startCommand} on :${project.port} ===`);

  const child = spawn(project.startCommand, {
    cwd: paths.repoDir,
    env: {
      ...process.env,
      ...parseEnvText(project.envText),
      PORT: String(project.port),
      PUBLIC_ORIGIN: config.publicOrigin,
      PLAYGROUND_SLUG: project.slug,
      PLAYGROUND_BASE_PATH: `/${project.slug}/`
    },
    shell: true,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true
  });

  child.unref();
  return mark(project, "running", "start", { pid: child.pid });
}

async function stopProject(project, options = {}) {
  if (!project.pid) return project;

  if (!options.quiet) await appendLog(project.slug, `=== stop pid ${project.pid} ===`);

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(project.pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(-Number(project.pid), "SIGTERM");
    }
  } catch (error) {
    if (!options.quiet) await appendLog(project.slug, `stop warning: ${error.message}`);
  }

  return mark(project, "stopped", "stop", { pid: null });
}

module.exports = {
  appendLog,
  buildProject,
  cloneOrSync,
  deployProject,
  installProject,
  readLog,
  startProject,
  stopProject
};
