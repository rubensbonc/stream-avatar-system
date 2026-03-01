const WebSocket = require('ws');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // channel -> Set of clients
  }

  init(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const channel = url.searchParams.get('channel') || 'general';

      if (!this.clients.has(channel)) {
        this.clients.set(channel, new Set());
      }
      this.clients.get(channel).add(ws);

      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('close', () => {
        this.clients.get(channel)?.delete(ws);
      });

      // Send welcome
      ws.send(JSON.stringify({ type: 'connected', channel }));
    });

    // Heartbeat
    setInterval(() => {
      this.wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  /**
   * Broadcast to all clients on a channel.
   */
  broadcast(channel, type, data) {
    const channelClients = this.clients.get(channel);
    if (!channelClients) return;

    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    channelClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  /**
   * Broadcast to ALL clients on ALL channels.
   */
  broadcastAll(type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    this.wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }
}

module.exports = new WebSocketService();
