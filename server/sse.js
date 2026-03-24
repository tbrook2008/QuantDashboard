// Server-Sent Events (SSE) Manager for pushing live data to browser clients
const clients = new Set();

function addClient(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Explicitly flush headers to prevent buffering and keep connection open
    res.flushHeaders(); 

    clients.add(res);

    req.on('close', () => {
        clients.delete(res);
    });
}

function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
        // Only write to active clients
        try {
            client.write(payload);
        } catch (e) {
            clients.delete(client);
        }
    }
}

// Keep connection alive by sending a ping every 30 seconds
setInterval(() => {
    broadcast('ping', { time: new Date().toISOString() });
}, 30000);

module.exports = {
    addClient, broadcast
};
