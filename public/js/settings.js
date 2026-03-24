document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('logout-btn')?.addEventListener('click', (e) => {
        e.preventDefault();
        sessionStorage.removeItem('mp_token');
        window.location.href = '/login';
    });

    const wlInput = document.getElementById('wl');
    const err = document.getElementById('err-msg');
    const msg = document.getElementById('status-msg');

    // Fetch existing states securely
    try {
        const data = await window.api.get('/config');
        if (data.watchlist) {
            wlInput.value = data.watchlist.join(', ');
        }
    } catch(e) {
        err.textContent = "Failed to load config: " + e.message;
        err.style.display = 'block';
    }

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        err.style.display = 'none';
        msg.style.display = 'none';

        const payload = {};
        
        const ak = document.getElementById('ak').value;
        const as = document.getElementById('as').value;
        const pk = document.getElementById('pk').value;
        const lk = document.getElementById('lk').value;
        const rawWl = document.getElementById('wl').value;

        if (ak) payload.alpaca_key = ak;
        if (as) payload.alpaca_secret = as;
        if (pk) payload.polygon_key = pk;
        if (lk) payload.llm_key = lk;
        
        if (rawWl) {
            payload.watchlist = rawWl.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        }

        try {
            await window.api.post('/config', payload);
            msg.textContent = "System parameters locked and saved successfully.";
            msg.style.display = 'block';
            
            // Wipe inputs
            document.getElementById('ak').value = '';
            document.getElementById('as').value = '';
            document.getElementById('pk').value = '';
            document.getElementById('lk').value = '';
            
            setTimeout(() => { msg.style.display = 'none'; }, 4000);
        } catch(e) {
            err.textContent = e.message;
            err.style.display = 'block';
        }
    });
});
