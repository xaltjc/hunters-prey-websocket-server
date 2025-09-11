# Hunters and Prey WebSocket Server

## Render Deployment

This WebSocket server handles real-time communication for the Hunters and Prey PWA game.

### Features
- Real-time player location sharing
- Game room management
- Perimeter violation alerts
- Cross-platform communication

### Environment Variables
- `PORT` - Automatically set by Render
- `NODE_ENV` - Set to "production" for optimizations

### Endpoints
- WebSocket: `wss://your-app-name.onrender.com`
- Health Check: `https://your-app-name.onrender.com/health`

### Usage
Connect from your PWA using:
```javascript
const WEBSOCKET_URL = 'wss://your-app-name.onrender.com';
```

### Deployment Notes
- Runs on Node.js 18+
- Automatically scales with Render
- Includes CORS for cross-origin requests
- Supports secure WebSocket connections (WSS)