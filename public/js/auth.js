document.addEventListener('DOMContentLoaded', async () => {
    const authForm = document.getElementById('auth-form');
    const authBtn = document.getElementById('auth-btn');
    const authError = document.getElementById('auth-error');
    const pageSubtitle = document.getElementById('page-subtitle');
    const keysForm = document.getElementById('keys-form');
    
    let isSetupMode = false;

    // Ping the backend to see if the database has a master password set yet
    try {
        const { setupComplete } = await window.api.get('/auth/status');
        if (!setupComplete) {
            isSetupMode = true;
            authBtn.textContent = 'Set Master Password';
            pageSubtitle.textContent = 'Initial System Configuration';
        }
    } catch (err) {
        authError.textContent = 'Cannot connect to backend server. Ensure Node.js is running.';
        authError.style.display = 'block';
        authBtn.disabled = true;
    }

    // Handle form submit (Login or Set Password)
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        authError.style.display = 'none';
        
        const password = document.getElementById('password').value;
        const endpoint = isSetupMode ? '/auth/setup' : '/auth/login';

        authBtn.textContent = 'Loading...';
        authBtn.disabled = true;

        try {
            const res = await window.api.post(endpoint, { password });
            if (res.token) {
                sessionStorage.setItem('mp_token', res.token);
                
                if (isSetupMode) {
                    // Transition to API Keys Setup Wizard smoothly
                    authForm.style.display = 'none';
                    keysForm.style.display = 'block';
                    pageSubtitle.textContent = 'Configure Data Providers';
                } else {
                    // Standard Login - move to dashboard right away
                    window.location.href = '/markets';
                }
            }
        } catch (err) {
            authError.textContent = err.message || "Failed to authenticate";
            authError.style.display = 'block';
            authBtn.textContent = isSetupMode ? 'Set Master Password' : 'Unlock Engine';
            authBtn.disabled = false;
        }
    });

    // Handle API Keys Setup Save
    keysForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const keysError = document.getElementById('keys-error');
        const saveBtn = document.getElementById('save-keys-btn');
        keysError.style.display = 'none';
        saveBtn.disabled = true;
        saveBtn.textContent = "Encrypting and Saving...";
        
        const keys = {
            ALPACA_KEY: document.getElementById('alpaca-key').value,
            ALPACA_SECRET: document.getElementById('alpaca-secret').value,
            POLYGON_KEY: document.getElementById('polygon-key').value,
            LLM_KEY: document.getElementById('llm-key').value
        };

        try {
            await window.api.post('/auth/keys', keys);
            
            // Setup complete, redirect to dashboard hub
            window.location.href = '/markets';
        } catch (err) {
            keysError.textContent = err.message || "Failed to save API keys";
            keysError.style.display = 'block';
            saveBtn.disabled = false;
            saveBtn.textContent = "Save & Initialize System";
        }
    });
});
