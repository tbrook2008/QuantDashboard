document.addEventListener('DOMContentLoaded', async () => {
    // Logout Handler
    document.getElementById('logout-btn').addEventListener('click', (e) => {
        e.preventDefault();
        sessionStorage.removeItem('mp_token');
        window.location.href = '/login';
    });

    const newsContainer = document.getElementById('news-container');
    const moversContainer = document.getElementById('movers-container');

    // 1. Fetch initial API data for the dashboard (Includes ML Sentiment processing via Node.js endpoints)
    try {
        const data = await window.api.get('/market/dashboard');
        
        // Render News 
        if (data.news && data.news.length > 0) {
            newsContainer.innerHTML = data.news.map(article => `
                <div class="news-item">
                    <div class="news-meta">
                        <div class="news-time">${new Date(article.published_utc || Date.now()).toLocaleTimeString()} - Polygon</div>
                        <div class="ai-sentiment sentiment-${article.aiSentiment}">[ ${article.aiSentiment} ]</div>
                    </div>
                    <div class="news-title"><a href="${article.article_url}" target="_blank">${article.title}</a></div>
                </div>
            `).join('');
        } else {
            newsContainer.innerHTML = '<p>No critical financial news currently detected.</p>';
        }

        // Render Top Movers
        if (data.movers && data.movers.length > 0) {
            const tableHtml = `
                <table class="movers-table">
                    ${data.movers.map(m => `
                        <tr>
                            <td class="movers-symbol">${m.ticker}</td>
                            <td class="movers-change">+${m.todaysChangePerc.toFixed(2)}%</td>
                        </tr>
                    `).join('')}
                </table>
            `;
            moversContainer.innerHTML = tableHtml;
        } else {
            moversContainer.innerHTML = '<p>No movers data available. API rate limits may be active.</p>';
        }

    } catch (err) {
        newsContainer.innerHTML = `<p style="color:red">Failed to load market feeds: ${err.message}</p>`;
        moversContainer.innerHTML = `<p style="color:red">Failed to load movers data.</p>`;
    }

    // 2. Establish persistent continuous Server-Sent Events stream connection to backend
    const token = sessionStorage.getItem('mp_token');
    if (token) {
        const eventSource = new EventSource(`/api/market/stream?token=${token}`);
        
        eventSource.onopen = () => {
            console.log("SSE Connection to Real-time Signal Stream Active.");
        };

        // Ping listener for connection heartbeat
        eventSource.addEventListener('ping', (e) => {
            // Future UI feature: show connection health 'green dot' 
        });

        eventSource.onerror = (e) => {
            console.error("SSE Signal Stream Interrupted", e);
        };
    }
});
