// ═══════════════════════════════════════════════════════
//  MarketPulse — Auth Client
// ═══════════════════════════════════════════════════════

async function submitLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value.trim();
  const errEl = document.getElementById('login-error');
  
  if (!user || !pass) {
    errEl.textContent = 'Enter username and password';
    errEl.style.display = 'block';
    return;
  }
  
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error);
    
    localStorage.setItem('token', data.token);
    errEl.style.display = 'none';
    initApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

async function submitRegister() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value.trim();
  const errEl = document.getElementById('login-error');
  
  if (!user || !pass) {
    errEl.textContent = 'Enter username and password';
    errEl.style.display = 'block';
    return;
  }
  
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error);
    
    localStorage.setItem('token', data.token);
    errEl.style.display = 'none';
    initApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  }
}

function logout() {
  localStorage.removeItem('token');
  window.location.reload();
}
