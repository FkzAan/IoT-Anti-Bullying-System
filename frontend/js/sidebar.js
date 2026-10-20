const SIDEBAR_LINKS = [
  {
    href: "/index.html", label: "Dashboard", key: "home",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  },
  {
    href: "/live.html", label: "Live Monitoring", key: "live",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>`,
  },
  {
    href: "/alerts.html", label: "Alert History", key: "alerts",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  },
  {
    href: "/devices.html", label: "Device Management", key: "devices",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>`,
  },
  {
    href: "/analytics.html", label: "Analytics", key: "analytics",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  },
];

function renderSidebar(activeKey) {
  const container = document.getElementById("sidebar-container");
  if (!container) return;

  const links = SIDEBAR_LINKS.map(
    (l) => `
    <a class="nav-link ${l.key === activeKey ? "active" : ""}" href="${l.href}">
      ${l.icon}
      ${l.label}
    </a>`
  ).join("");

  container.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="logo-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div>
          <div class="brand-name">Sentry Admin</div>
          <div class="brand-sub">Anti-Bullying IoT</div>
        </div>
      </div>

      <div class="nav-section-label">Navigation</div>
      ${links}

      <div class="sidebar-footer">
        <div class="user-row">
          <div class="user-avatar" id="user-avatar">?</div>
          <div class="user-info">
            <span class="user-label">Signed in as</span>
            <span id="current-username">…</span>
          </div>
        </div>
        <button class="logout-btn" id="logout-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Log out
        </button>
      </div>
    </aside>
  `;

  // Keep avatar initial in sync with username
  const usernameEl = document.getElementById("current-username");
  const avatarEl   = document.getElementById("user-avatar");
  const observer   = new MutationObserver(() => {
    const name = usernameEl.textContent.trim();
    if (name && name !== "…") avatarEl.textContent = name[0].toUpperCase();
  });
  observer.observe(usernameEl, { childList: true, characterData: true, subtree: true });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await API.post("/api/auth/logout", {});
    window.location.href = "/login.html";
  });
}
