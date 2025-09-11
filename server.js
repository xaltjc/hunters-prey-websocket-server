const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Express server for health checks and static files
const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Use Render's assigned port
const PORT = process.env.PORT || 3000;

// Start HTTP server
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket available at wss://your-domain.onrender.com`);
});

// WebSocket Server - attached to the same HTTP server
const wss = new WebSocket.Server({ server });

// Game state management
const games = new Map();
const players = new Map();

class Game {
    constructor(id, password, creatorId) {
        this.id = id;
        this.password = password;
        this.creatorId = creatorId;
        this.players = new Map();
        this.isActive = false;
        this.startTime = null;
        this.perimeter = {
            centerLat: null,
            centerLon: null,
            radius: 1000
        };
        this.lastPreyPings = new Map();
    }

    addPlayer(playerId, playerData) {
        this.players.set(playerId, {
            id: playerId,
            role: playerData.role,
            lastLocation: null,
            lastSeen: Date.now(),
            ...playerData
        });
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
    }

    updatePlayerLocation(playerId, location) {
        const player = this.players.get(playerId);
        if (player) {
            player.lastLocation = location;
            player.lastSeen = Date.now();
        }
    }

    getActivePreyPlayers() {
        return Array.from(this.players.values()).filter(p => p.role === 'prey');
    }

    getActiveHunterPlayers() {
        return Array.from(this.players.values()).filter(p => p.role === 'hunter');
    }

    broadcast(message, excludePlayerId = null) {
        this.players.forEach((player, playerId) => {
            if (playerId !== excludePlayerId) {
                const ws = players.get(playerId);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(message));
                }
            }
        });
    }
}

class Player {
    constructor(ws, id) {
        this.ws = ws;
        this.id = id;
        this.gameId = null;
        this.role = null;
        this.lastPing = Date.now();
    }

    send(message) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    const playerId = uuidv4();
    const player = new Player(ws, playerId);
    players.set(playerId, ws);
    
    console.log(`Player ${playerId} connected`);

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'connected',
        payload: { playerId }
    }));

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(playerId, message);
        } catch (error) {
            console.error('Invalid message format:', error);
            ws.send(JSON.stringify({
                type: 'error',
                payload: { message: 'Invalid message format' }
            }));
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected`);
        handlePlayerDisconnect(playerId);
        players.delete(playerId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${playerId}:`, error);
    });

    // Ping interval to keep connection alive
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        } else {
            clearInterval(pingInterval);
        }
    }, 30000);
});

// Message handler
function handleMessage(playerId, message) {
    const { type, payload } = message;
    const ws = players.get(playerId);

    if (!ws) return;

    switch (type) {
        case 'create_game':
            handleCreateGame(playerId, payload);
            break;
        case 'join_game':
            handleJoinGame(playerId, payload);
            break;
        case 'leave_game':
            handleLeaveGame(playerId);
            break;
        case 'start_game':
            handleStartGame(playerId, payload);
            break;
        case 'location_update':
            handleLocationUpdate(playerId, payload);
            break;
        case 'role_change':
            handleRoleChange(playerId, payload);
            break;
        case 'set_perimeter':
            handleSetPerimeter(playerId, payload);
            break;
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        default:
            console.log(`Unknown message type: ${type}`);
    }
}

// Create game handler
function handleCreateGame(playerId, payload) {
    const { password, perimeterRadius, playerRole } = payload;
    const gameId = uuidv4();
    
    const game = new Game(gameId, password, playerId);
    game.perimeter.radius = perimeterRadius || 1000;
    
    games.set(gameId, game);
    
    game.addPlayer(playerId, {
        role: playerRole || 'prey',
        name: payload.playerName || `Player-${playerId.slice(0, 6)}`
    });

    const ws = players.get(playerId);
    ws.send(JSON.stringify({
        type: 'game_created',
        payload: {
            gameId,
            game: {
                id: gameId,
                isActive: game.isActive,
                perimeter: game.perimeter,
                players: Array.from(game.players.values())
            }
        }
    }));

    console.log(`Game ${gameId} created by player ${playerId}`);
}

// Join game handler
function handleJoinGame(playerId, payload) {
    const { password, playerRole, gameId } = payload;
    
    // Find game by password (simplified - in production, use proper game lookup)
    let targetGame = null;
    if (gameId) {
        targetGame = games.get(gameId);
    } else {
        // Find by password
        for (const game of games.values()) {
            if (game.password === password) {
                targetGame = game;
                break;
            }
        }
    }

    if (!targetGame) {
        const ws = players.get(playerId);
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Game not found or invalid password' }
        }));
        return;
    }

    targetGame.addPlayer(playerId, {
        role: playerRole || 'hunter',
        name: payload.playerName || `Player-${playerId.slice(0, 6)}`
    });

    const ws = players.get(playerId);
    ws.send(JSON.stringify({
        type: 'game_joined',
        payload: {
            gameId: targetGame.id,
            game: {
                id: targetGame.id,
                isActive: targetGame.isActive,
                perimeter: targetGame.perimeter,
                players: Array.from(targetGame.players.values())
            }
        }
    }));

    // Broadcast to other players
    targetGame.broadcast({
        type: 'player_joined',
        payload: {
            playerId,
            playerName: payload.playerName || `Player-${playerId.slice(0, 6)}`,
            role: playerRole || 'hunter'
        }
    }, playerId);

    console.log(`Player ${playerId} joined game ${targetGame.id}`);
}

// Leave game handler
function handleLeaveGame(playerId) {
    const game = findPlayerGame(playerId);
    if (!game) return;

    const player = game.players.get(playerId);
    game.removePlayer(playerId);

    // Broadcast to remaining players
    game.broadcast({
        type: 'player_left',
        payload: {
            playerId,
            playerName: player ? player.name : 'Unknown'
        }
    });

    // If game creator left, end the game
    if (game.creatorId === playerId) {
        game.broadcast({
            type: 'game_ended',
            payload: { reason: 'Host left the game' }
        });
        games.delete(game.id);
    }

    console.log(`Player ${playerId} left game ${game.id}`);
}

// Start game handler
function handleStartGame(playerId, payload) {
    const game = findPlayerGame(playerId);
    if (!game) return;

    if (game.creatorId !== playerId) {
        const ws = players.get(playerId);
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Only game creator can start the game' }
        }));
        return;
    }

    game.isActive = true;
    game.startTime = Date.now();

    game.broadcast({
        type: 'game_started',
        payload: {
            startTime: game.startTime,
            perimeter: game.perimeter
        }
    });

    console.log(`Game ${game.id} started`);
}

// Location update handler
function handleLocationUpdate(playerId, payload) {
    const game = findPlayerGame(playerId);
    if (!game) return;

    const { lat, lon, timestamp, accuracy } = payload;
    
    game.updatePlayerLocation(playerId, {
        lat,
        lon,
        timestamp: timestamp || Date.now(),
        accuracy
    });

    const player = game.players.get(playerId);
    if (!player) return;

    // Broadcast location to other players (hunters see prey locations)
    if (player.role === 'prey') {
        game.broadcast({
            type: 'location_update',
            payload: {
                playerId,
                lat,
                lon,
                role: 'prey',
                timestamp: timestamp || Date.now()
            }
        }, playerId);

        // Update last prey ping time
        game.lastPreyPings.set(playerId, Date.now());
    }

    console.log(`Location update from ${playerId} in game ${game.id}: ${lat}, ${lon}`);
}

// Role change handler
function handleRoleChange(playerId, payload) {
    const game = findPlayerGame(playerId);
    if (!game) return;

    const { newRole } = payload;
    const player = game.players.get(playerId);
    
    if (player) {
        player.role = newRole;
        
        game.broadcast({
            type: 'role_changed',
            payload: {
                playerId,
                newRole,
                playerName: player.name
            }
        });
    }
}

// Set perimeter handler
function handleSetPerimeter(playerId, payload) {
    const game = findPlayerGame(playerId);
    if (!game) return;

    if (game.creatorId !== playerId) {
        const ws = players.get(playerId);
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Only game creator can set perimeter' }
        }));
        return;
    }

    const { centerLat, centerLon, radius } = payload;
    game.perimeter = { centerLat, centerLon, radius };

    game.broadcast({
        type: 'perimeter_updated',
        payload: { perimeter: game.perimeter }
    });

    console.log(`Perimeter updated for game ${game.id}`);
}

// Player disconnect handler
function handlePlayerDisconnect(playerId) {
    const game = findPlayerGame(playerId);
    if (game) {
        handleLeaveGame(playerId);
    }
}

// Helper function to find game by player ID
function findPlayerGame(playerId) {
    for (const game of games.values()) {
        if (game.players.has(playerId)) {
            return game;
        }
    }
    return null;
}

// Cleanup inactive games every 5 minutes
setInterval(() => {
    const now = Date.now();
    const maxInactiveTime = 30 * 60 * 1000; // 30 minutes

    for (const [gameId, game] of games.entries()) {
        let hasActivePlayers = false;
        
        for (const [playerId, player] of game.players.entries()) {
            if (now - player.lastSeen < maxInactiveTime) {
                hasActivePlayers = true;
                break;
            }
        }

        if (!hasActivePlayers) {
            console.log(`Cleaning up inactive game ${gameId}`);
            games.delete(gameId);
        }
    }
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});