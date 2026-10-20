(async function init() {
  const session = await requireSession();
  if (!session) return;
  renderSidebar("analytics");

  await Promise.all([renderIncidentsChart(), renderSoundChart(), renderUptimeTable()]);
})();

const CHART_COLORS = {
  amber: "#ff9f1c",
  alarm: "#ff4d5e",
  ok: "#2dd4a7",
  grid: "#262f3b",
  text: "#8b98a8",
};

async function renderIncidentsChart() {
  try {
    const data = await API.get("/api/analytics/incidents-per-day?days=14");
    const ctx = document.getElementById("chart-incidents");
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map((d) => new Date(d.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })),
        datasets: [{ label: "Incidents", data: data.map((d) => d.count), backgroundColor: CHART_COLORS.alarm, borderRadius: 4 }],
      },
      options: chartOptions(),
    });
  } catch (err) {
    console.error(err);
  }
}

async function renderSoundChart() {
  try {
    const data = await API.get("/api/analytics/sound-frequency");
    const ctx = document.getElementById("chart-sound");
    new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: data.map((d) => d.sound_type),
        datasets: [{
          data: data.map((d) => d.count),
          backgroundColor: data.map((d) => (d.sound_type === "Distress Sound" ? CHART_COLORS.alarm : CHART_COLORS.ok)),
          borderColor: "#151b23",
          borderWidth: 2,
        }],
      },
      options: {
        plugins: { legend: { position: "bottom", labels: { color: CHART_COLORS.text, font: { family: "Inter" } } } },
      },
    });
  } catch (err) {
    console.error(err);
  }
}

async function renderUptimeTable() {
  const body = document.getElementById("uptime-body");
  try {
    const rows = await API.get("/api/analytics/device-uptime");
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="3" class="empty-state">No devices registered.</td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(
        (r) => `
      <tr>
        <td>${r.device_name}</td>
        <td><span class="status-pill ${r.status}"><span class="dot"></span>${r.status}</span></td>
        <td class="mono">${r.minutes_since_last_seen != null ? r.minutes_since_last_seen + " min ago" : "never"}</td>
      </tr>`
      )
      .join("");
  } catch (err) {
    body.innerHTML = `<tr><td colspan="3" class="empty-state">Failed to load.</td></tr>`;
  }
}

function chartOptions() {
  return {
    scales: {
      x: { ticks: { color: CHART_COLORS.text, font: { family: "Inter" } }, grid: { color: CHART_COLORS.grid } },
      y: { ticks: { color: CHART_COLORS.text, font: { family: "Inter" }, precision: 0 }, grid: { color: CHART_COLORS.grid } },
    },
    plugins: { legend: { display: false } },
  };
}
