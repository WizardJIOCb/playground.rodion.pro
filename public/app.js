const state = {
  projects: [],
  selectedSlug: "",
  config: { authRequired: false, publicOrigin: window.location.origin }
};

const els = {
  tokenForm: document.querySelector("#tokenForm"),
  adminToken: document.querySelector("#adminToken"),
  createForm: document.querySelector("#createForm"),
  detailForm: document.querySelector("#detailForm"),
  projects: document.querySelector("#projects"),
  emptyState: document.querySelector("#emptyState"),
  refreshButton: document.querySelector("#refreshButton"),
  deleteButton: document.querySelector("#deleteButton"),
  openProject: document.querySelector("#openProject"),
  statusLine: document.querySelector("#statusLine"),
  logs: document.querySelector("#logs"),
  toast: document.querySelector("#toast")
};

function token() {
  return localStorage.getItem("playgroundAdminToken") || "";
}

function headers(json = true) {
  const result = {};
  if (json) result["content-type"] = "application/json";
  if (token()) result["x-admin-token"] = token();
  return result;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...headers(options.body !== undefined),
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error;
    } catch {}
    throw new Error(message || `HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  setTimeout(() => els.toast.classList.remove("visible"), 2800);
}

function selectedProject() {
  return state.projects.find((project) => project.slug === state.selectedSlug) || null;
}

function projectUrl(project) {
  return `${state.config.publicOrigin.replace(/\/$/, "")}/${project.slug}/`;
}

function renderProjects() {
  if (!state.projects.length) {
    els.projects.innerHTML = '<div class="empty-card">Пока нет проектов.</div>';
    return;
  }

  els.projects.innerHTML = state.projects.map((project) => `
    <button class="project-card ${project.slug === state.selectedSlug ? "active" : ""}" data-slug="${project.slug}" type="button">
      <span class="card-title">${escapeHtml(project.name)}</span>
      <span class="card-slug">/${escapeHtml(project.slug)}</span>
      <span class="card-meta">${escapeHtml(project.status || "created")} · ${escapeHtml(project.serveMode || "static")}</span>
    </button>
  `).join("");
}

function fillDetail(project) {
  if (!project) {
    els.emptyState.classList.remove("hidden");
    els.detailForm.classList.add("hidden");
    els.openProject.href = "/";
    els.statusLine.textContent = "";
    els.logs.textContent = "";
    return;
  }

  els.emptyState.classList.add("hidden");
  els.detailForm.classList.remove("hidden");
  els.openProject.href = projectUrl(project);
  els.statusLine.textContent = [
    `status: ${project.status || "created"}`,
    project.lastAction ? `last: ${project.lastAction}` : "",
    project.pid ? `pid: ${project.pid}` : "",
    project.lastError ? `error: ${project.lastError}` : ""
  ].filter(Boolean).join(" | ");

  for (const [key, value] of Object.entries(project)) {
    const field = els.detailForm.elements[key];
    if (!field) continue;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? "";
  }

  loadLogs(project.slug);
}

async function loadConfig() {
  state.config = await api("/api/config", { headers: {} });
  els.tokenForm.hidden = !state.config.authRequired;
  els.adminToken.value = token();
}

async function loadProjects(keepSelection = true) {
  state.projects = await api("/api/projects", { headers: {} });
  if (!keepSelection || !state.projects.some((project) => project.slug === state.selectedSlug)) {
    state.selectedSlug = state.projects[0]?.slug || "";
  }
  renderProjects();
  fillDetail(selectedProject());
}

async function loadLogs(slug) {
  if (!slug) return;
  const text = await api(`/api/projects/${slug}/logs`, { headers: {} });
  if (slug === state.selectedSlug) {
    els.logs.textContent = text || "Лог пока пуст.";
    els.logs.scrollTop = els.logs.scrollHeight;
  }
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  data.proxyStripPrefix = form.elements.proxyStripPrefix.checked;
  return data;
}

async function saveSelected() {
  const project = selectedProject();
  if (!project) return;
  await api(`/api/projects/${project.slug}`, {
    method: "PATCH",
    body: JSON.stringify(formData(els.detailForm))
  });
  await loadProjects(true);
  toast("Настройки сохранены.");
}

async function runProjectAction(action) {
  const project = selectedProject();
  if (!project) return;
  await saveSelected();
  toast(`Запущено: ${action}`);
  await api(`/api/projects/${project.slug}/${action}`, { method: "POST", body: "{}" });
  await loadProjects(true);
  toast(`${action}: готово`);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

els.tokenForm.addEventListener("submit", (event) => {
  event.preventDefault();
  localStorage.setItem("playgroundAdminToken", els.adminToken.value.trim());
  toast("Token сохранен в браузере.");
});

els.createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(els.createForm).entries());
  const project = await api("/api/projects", {
    method: "POST",
    body: JSON.stringify(data)
  });
  els.createForm.reset();
  state.selectedSlug = project.slug;
  await loadProjects(true);
  toast("Проект создан.");
});

els.projects.addEventListener("click", (event) => {
  const card = event.target.closest("[data-slug]");
  if (!card) return;
  state.selectedSlug = card.dataset.slug;
  renderProjects();
  fillDetail(selectedProject());
});

els.refreshButton.addEventListener("click", () => loadProjects(true));

els.detailForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSelected();
});

els.detailForm.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  await runProjectAction(button.dataset.action);
});

els.deleteButton.addEventListener("click", async () => {
  const project = selectedProject();
  if (!project) return;
  const removeFiles = window.confirm(`Удалить проект ${project.name} вместе с файлами?`);
  await api(`/api/projects/${project.slug}?files=${removeFiles ? "1" : "0"}`, { method: "DELETE", body: "{}" });
  state.selectedSlug = "";
  await loadProjects(false);
  toast("Проект удален.");
});

window.addEventListener("unhandledrejection", (event) => {
  toast(event.reason?.message || "Ошибка");
});

loadConfig()
  .then(() => loadProjects(false))
  .catch((error) => toast(error.message));

setInterval(() => {
  const project = selectedProject();
  if (project) loadLogs(project.slug).catch(() => {});
}, 5000);
