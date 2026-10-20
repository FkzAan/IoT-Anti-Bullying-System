document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("error-text");
  const btn = document.getElementById("submit-btn");
  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Signing in…";

  try {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    await API.post("/api/auth/login", { username, password });
    window.location.href = "/index.html";
  } catch (err) {
    errorEl.textContent = err.message || "Login failed.";
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

// If already logged in, skip straight to the dashboard
API.get("/api/auth/me").then((r) => {
  if (r && r.authenticated) window.location.href = "/index.html";
});
