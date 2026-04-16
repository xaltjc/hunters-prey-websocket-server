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
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        activeGames: games.size,
        connectedPlayers: players.size
    });
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
        this.createdAt = Date.now();
        this.name = null;
        this.boundary = null;
        this.startingPoint = null;
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
        case 'get_active_games':
            handleGetActiveGames(playerId);
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
        case 'prey_caught':
            handlePreyCaught(playerId, payload);
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

// Get active games handler
function handleGetActiveGames(playerId) {
    const ws = players.get(playerId);
    if (!ws) return;

    const activeGames = [];
    
    for (const game of games.values()) {
        // Only include games that are waiting for players (not started yet)
        if (!game.isActive && game.players.size > 0) {
            activeGames.push({
                id: game.id,
                name: game.name || `Game-${game.id.slice(0, 8)}`, // Use stored game name
                creator: Array.from(game.players.values()).find(p => p.id === game.creatorId)?.name || 'Unknown',
                players: game.players.size,
                maxPlayers: 20, // Increased from 8 to 20
                status: 'waiting',
                created: getTimeAgo(game.createdAt || Date.now()),
                hasPassword: Boolean(game.password)
            });
        }
    }

    ws.send(JSON.stringify({
        type: 'active_games',
        payload: { games: activeGames }
    }));
}

// Helper function to get time ago string
function getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

// Create game handler
function handleCreateGame(playerId, payload) {
    const { password, gameName, boundary, startingPoint } = payload;
    const gameId = uuidv4();
    
    const game = new Game(gameId, password, playerId);
    game.name = gameName || `Game-${gameId.slice(0, 8)}`;
    game.boundary = boundary || null;
    game.startingPoint = startingPoint || null;
    
    games.set(gameId, game);
    
    // Player joins lobby with no role yet
    game.addPlayer(playerId, {
        role: null,
        name: payload.playerName || `Player-${playerId.slice(0, 6)}`
    });

    const ws = players.get(playerId);
    ws.send(JSON.stringify({
        type: 'game_created',
        payload: {
            gameId,
            isCreator: true,
            game: {
                id: gameId,
                name: game.name,
                isActive: game.isActive,
                boundary: game.boundary,
                startingPoint: game.startingPoint,
                creatorId: game.creatorId,
                players: Array.from(game.players.values())
            }
        }
    }));

    console.log(`Game ${gameId} created by player ${playerId}`);
}

// Join game handler
function handleJoinGame(playerId, payload) {
    const { password, gameId } = payload;
    
    let targetGame = null;
    if (gameId) {
        targetGame = games.get(gameId);
    }

    if (!targetGame) {
        const ws = players.get(playerId);
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Game not found' }
        }));
        return;
    }

    // Don't allow joining started games
    if (targetGame.isActive) {
        const ws = players.get(playerId);
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Game has already started' }
        }));
        return;
    }

    // Validate password
    if (targetGame.password && targetGame.password !== password) {
        const ws = players.get(playerId);
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Invalid password' }
        }));
        return;
    }

    // Player joins lobby with no role yet
    targetGame.addPlayer(playerId, {
        role: null,
        name: payload.playerName || `Player-${playerId.slice(0, 6)}`
    });

    const ws = players.get(playerId);
    ws.send(JSON.stringify({
        type: 'game_joined',
        payload: {
            gameId: targetGame.id,
            isCreator: false,
            game: {
                id: targetGame.id,
                name: targetGame.name,
                isActive: targetGame.isActive,
                boundary: targetGame.boundary,
                startingPoint: targetGame.startingPoint,
                creatorId: targetGame.creatorId,
                players: Array.from(targetGame.players.values())
            }
        }
    }));

    // Broadcast updated lobby to all players
    broadcastLobbyUpdate(targetGame);

    console.log(`Player ${playerId} joined game ${targetGame.id}`);
}

// Leave game handler
function handleLeaveGame(playerId) {
    const game = findPlayerGame(playerId);
    if (!game) return;

    const player = game.players.get(playerId);
    game.removePlayer(playerId);

    // If game creator left, end the game
    if (game.creatorId === playerId) {
        game.broadcast({
            type: 'game_ended',
            payload: { reason: 'Host left the game' }
        });
        games.delete(game.id);
    } else {
        // Broadcast updated lobby to remaining players
        broadcastLobbyUpdate(game);
    }

    console.log(`Player ${playerId} left game ${game.id}`);
}

// Broadcast lobby state to all players in the game
function broadcastLobbyUpdate(game) {
    const playerList = Array.from(game.players.values());
    const allReady = playerList.length > 0 && playerList.every(p => p.role && p.roleLocked);

    // Send to all players in the game
    game.players.forEach((player, pid) => {
        const ws = players.get(pid);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'lobby_update',
                payload: {
                    players: playerList,
                    allReady,
                    creatorId: game.creatorId
                }
            }));
        }
    });
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

    // Check all players have selected and locked roles
    const allReady = Array.from(game.players.values()).every(p => p.role && p.roleLocked);
    if (!allReady) {
        const ws = players.get(playerId);
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'All players must select a role before starting' }
        }));
        return;
    }

    // Ensure there is exactly one prey
    if (game.getActivePreyPlayers().length !== 1) {
        const ws = players.get(playerId);
        ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'There must be exactly one Prey to start the game' }
        }));
        return;
    }

    game.isActive = true;
    game.startTime = Date.now();

    game.broadcast({
        type: 'game_started',
        payload: {
            startTime: game.startTime,
            perimeter: game.perimeter,
            players: Array.from(game.players.values())
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

// Prey caught handler
function handlePreyCaught(playerId, payload) {
    const game = findPlayerGame(playerId);
    if (!game) return;

    const { hunterId, hunterName, location, timestamp } = payload;
    const player = game.players.get(playerId);
    
    if (!player || player.role !== 'hunter') {
        console.log('Prey caught attempt by non-hunter player:', playerId);
        return;
    }

    console.log(`Prey caught by hunter ${playerId} in game ${game.id}`);

    // Broadcast prey caught to all players in the game
    game.broadcast({
        type: 'prey_caught',
        payload: {
            hunterId: playerId,
            hunterName: player.name || 'Hunter',
            location: location,
            timestamp: timestamp || Date.now()
        }
    });

    // Update game state - mark as prey caught
    game.preyCaught = {
        hunterId: playerId,
        hunterName: player.name || 'Hunter',
        location: location,
        timestamp: timestamp || Date.now()
    };
}

// Role change handler
function handleRoleChange(playerId, payload) {
    const game = findPlayerGame(playerId);
    if (!game) return;

    const { newRole } = payload;
    const player = game.players.get(playerId);
    if (!player) return;

    // Don't allow role changes once game is started
    if (game.isActive) {
        const ws = players.get(playerId);
        if (ws) ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Cannot change role after game has started' }
        }));
        return;
    }

    // Don't allow role changes once locked
    if (player.roleLocked) {
        const ws = players.get(playerId);
        if (ws) ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Your role is already locked' }
        }));
        return;
    }

    // Enforce only one prey
    if (newRole === 'prey' && game.getActivePreyPlayers().length > 0) {
        const ws = players.get(playerId);
        if (ws) ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Prey role is already taken. Please select Hunter.' }
        }));
        return;
    }

    player.role = newRole;
    player.roleLocked = true;

    // Confirm to the selecting player
    const ws = players.get(playerId);
    if (ws) ws.send(JSON.stringify({
        type: 'role_confirmed',
        payload: { role: newRole, locked: true }
    }));

    // Broadcast updated lobby to all
    broadcastLobbyUpdate(game);

    console.log(`Player ${playerId} selected role: ${newRole} (locked)`);
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

// Self-ping every 4 minutes to prevent Render spin-down while players are connected
setInterval(() => {
    if (players.size > 0) {
        const url = `http://localhost:${PORT}/health`;
        require('http').get(url, (res) => {
            console.log(`Self-ping: ${players.size} players, ${games.size} games`);
        }).on('error', () => {});
    }
}, 4 * 60 * 1000);

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