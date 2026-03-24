// Global fetch wrapper to handle JWT tokens and simplify API interactions

window.api = {
    async request(endpoint, options = {}) {
        const token = sessionStorage.getItem('mp_token');
        const headers = {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
            ...(options.headers || {})
        };

        const config = {
            ...options,
            headers
        };

        try {
            const response = await fetch(`/api${endpoint}`, config);
            const data = await response.json().catch(() => ({}));
            
            if (!response.ok) {
                // If token is invalid/expired and we aren't already on login, clear it out.
                if (response.status === 401 && window.location.pathname !== '/login') {
                    sessionStorage.removeItem('mp_token');
                    window.location.href = '/login';
                }
                throw new Error(data.error || `HTTP Error ${response.status}`);
            }
            
            return data;
        } catch (error) {
            console.error(`API Error on ${endpoint}:`, error);
            throw error;
        }
    },

    get(endpoint) {
        return this.request(endpoint, { method: 'GET' });
    },

    post(endpoint, body) {
        return this.request(endpoint, { 
            method: 'POST', 
            body: JSON.stringify(body) 
        });
    }
};
