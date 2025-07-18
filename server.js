const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Game state
const rooms = {}; // Stores game rooms, each with its players, choices, scores, and state

const MAX_PLAYERS_PER_ROOM = 2;
const ROUND_TIME_LIMIT = 15; // seconds

console.log('Server started. Waiting for players...');

wss.on('connection', ws => {
    let playerId = Math.random().toString(36).substr(2, 9); // Generate a unique ID for the player
    let roomId = null; // Room ID for the connected player
    let playerType = null; // 'player' or 'spectator'

    ws.on('message', message => {
        const data = JSON.parse(message);
        console.log(`Received from ${playerId} in room ${roomId}:`, data);

        switch (data.type) {
            case 'join_room':
            case 'join_spectator_room':
                // Clean up if player was previously in a room (e.g., due to reconnect)
                if (roomId && rooms[roomId] && rooms[roomId].players[playerId]) {
                    const oldRoom = rooms[roomId];
                    const oldPlayerType = oldRoom.players[playerId].type;

                    delete oldRoom.players[playerId];
                    if (oldPlayerType === 'player') {
                        oldRoom.playerIds = oldRoom.playerIds.filter(id => id !== playerId);
                        delete oldRoom.playerChoices[playerId];
                        oldRoom.readyPlayers.delete(playerId);
                    } else { // spectator
                        oldRoom.spectatorIds = oldRoom.spectatorIds.filter(id => id !== playerId);
                    }

                    if (oldRoom.playerIds.length === 0 && oldRoom.spectatorIds.length === 0) {
                        delete rooms[roomId]; // Clean up empty room
                        console.log(`Room ${roomId} is empty. Deleting room.`);
                    } else {
                        broadcastRoomState(roomId); // Update remaining clients
                    }
                }

                roomId = data.roomId;
                playerType = (data.type === 'join_spectator_room') ? 'spectator' : 'player';

                if (!rooms[roomId]) {
                    // Create new room
                    rooms[roomId] = {
                        players: {}, // { playerId: { ws, name, score, ready, type } }
                        playerIds: [], // Array of IDs of actual players
                        spectatorIds: [], // Array of IDs of spectators
                        playerChoices: {}, // { playerId: choice }
                        round: 0,
                        timer: null, // For round time limit
                        readyPlayers: new Set(), // Players ready for the next round
                        chatHistory: [], // Store chat messages
                    };
                    console.log(`Room ${roomId} created.`);
                }

                const room = rooms[roomId];

                // Check if room is full for players
                if (playerType === 'player' && room.playerIds.length >= MAX_PLAYERS_PER_ROOM) {
                    ws.send(JSON.stringify({ type: 'message', text: 'Game room is full. Please try another room or join as a spectator.' }));
                    ws.close();
                    return;
                }

                // Add player/spectator to room
                room.players[playerId] = {
                    ws: ws,
                    name: data.playerName || `${playerType === 'player' ? 'Player' : 'Spectator'}-${playerId.substring(0, 4)}`,
                    score: { wins: 0, losses: 0, ties: 0 }, // Scores only relevant for players, but keep structure
                    ready: false,
                    type: playerType
                };

                if (playerType === 'player') {
                    room.playerIds.push(playerId);
                    room.playerChoices[playerId] = null;
                } else { // spectator
                    room.spectatorIds.push(playerId);
                }


                ws.send(JSON.stringify({ type: 'player_id', id: playerId, name: room.players[playerId].name }));
                ws.send(JSON.stringify({ type: 'chat_history', history: room.chatHistory })); // Send chat history to new participant
                broadcastRoomState(roomId);
                console.log(`Player ${playerId} (${room.players[playerId].name}) joined room ${roomId} as ${playerType}. Total players in room: ${room.playerIds.length}, Spectators: ${room.spectatorIds.length}`);

                if (playerType === 'player') {
                    if (room.playerIds.length === MAX_PLAYERS_PER_ROOM) {
                        broadcastRoomMessage(roomId, 'Both players connected! Click "Ready" to start the game.');
                    } else {
                        broadcastRoomMessage(roomId, `Waiting for 1 more player... (${room.playerIds.length}/${MAX_PLAYERS_PER_ROOM})`);
                    }
                } else {
                    broadcastRoomMessage(roomId, `${room.players[playerId].name} joined as a spectator.`);
                }
                break;

            case 'choice':
                // Server-side validation: Only allow if participant is a player
                if (!roomId || !rooms[roomId] || rooms[roomId].players[playerId].type !== 'player') {
                    ws.send(JSON.stringify({ type: 'message', text: 'You cannot make a choice. You are not an active player.' }));
                    return;
                }
                const currentRoom = rooms[roomId];
                if (currentRoom.playerChoices[playerId] === null) {
                    currentRoom.playerChoices[playerId] = data.choice;
                    ws.send(JSON.stringify({ type: 'message', text: `You chose ${data.choice}. Waiting for opponent...` }));
                    console.log(`Player ${playerId} chose: ${data.choice}`);
                    checkRoundEnd(roomId);
                } else {
                    ws.send(JSON.stringify({ type: 'message', text: 'You have already made your choice for this round.' }));
                }
                break;

            case 'ready':
                // Server-side validation: Only allow if participant is a player
                if (!roomId || !rooms[roomId] || rooms[roomId].players[playerId].type !== 'player') {
                    ws.send(JSON.stringify({ type: 'message', text: 'You cannot set ready status. You are not an active player.' }));
                    return;
                }
                const roomToReady = rooms[roomId];
                roomToReady.players[playerId].ready = data.isReady;
                if (data.isReady) {
                    roomToReady.readyPlayers.add(playerId);
                    broadcastRoomMessage(roomId, `${roomToReady.players[playerId].name} is ready.`);
                } else {
                    roomToReady.readyPlayers.delete(playerId);
                    broadcastRoomMessage(roomId, `${roomToReady.players[playerId].name} is no longer ready.`);
                }
                broadcastRoomState(roomId); // Update client with ready status
                checkAllPlayersReady(roomId);
                break;

            case 'chat_message':
                // Server-side validation: Only allow if participant is a player (or if you want spectators to chat, remove this check)
                if (!roomId || !rooms[roomId] || rooms[roomId].players[playerId].type !== 'player') {
                    ws.send(JSON.stringify({ type: 'message', text: 'Spectators cannot send chat messages.' }));
                    return;
                }
                const senderName = rooms[roomId].players[playerId].name;
                const chatMessage = { sender: senderName, text: data.text, timestamp: new Date().toLocaleTimeString() };
                rooms[roomId].chatHistory.push(chatMessage);
                broadcastRoomChat(roomId, chatMessage);
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Participant ${playerId} disconnected.`);
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            const participant = room.players[playerId];
            const participantName = participant ? participant.name : 'Unknown Participant';
            const participantType = participant ? participant.type : 'unknown';

            delete room.players[playerId]; // Remove from general players object

            if (participantType === 'player') {
                room.playerIds = room.playerIds.filter(id => id !== playerId);
                delete room.playerChoices[playerId];
                room.readyPlayers.delete(playerId);
                broadcastRoomMessage(roomId, `${participantName} (Player) disconnected.`);

                if (room.playerIds.length < MAX_PLAYERS_PER_ROOM && room.playerIds.length > 0 && room.round > 0) {
                    // If a game was in progress and a player leaves, reset the round and choices
                    broadcastRoomMessage(roomId, 'Opponent disconnected. Waiting for another player...');
                    clearTimeout(room.timer);
                    resetRound(roomId);
                } else if (room.playerIds.length === 0 && room.spectatorIds.length > 0) {
                     broadcastRoomMessage(roomId, 'All players have left. Waiting for new players to join.');
                     clearTimeout(room.timer);
                     resetRound(roomId); // Reset game state for new players
                }

            } else { // spectator
                room.spectatorIds = room.spectatorIds.filter(id => id !== playerId);
                broadcastRoomMessage(roomId, `${participantName} (Spectator) disconnected.`);
            }

            // Clean up room if completely empty
            if (room.playerIds.length === 0 && room.spectatorIds.length === 0) {
                console.log(`Room ${roomId} is empty. Deleting room.`);
                clearTimeout(room.timer); // Clear any pending timers
                delete rooms[roomId];
            } else {
                broadcastRoomState(roomId); // Update remaining clients (players and spectators)
            }
        }
    });

    ws.on('error', error => {
        console.error(`WebSocket error for participant ${playerId}:`, error);
    });
});

/**
 * Broadcasts a message to all participants (players and spectators) in a specific room.
 * @param {string} roomId - The ID of the room.
 * @param {object} message - The message object to send.
 */
function broadcastRoom(roomId, message) {
    const room = rooms[roomId];
    if (room) {
        // Iterate over all participants (players and spectators)
        [...room.playerIds, ...room.spectatorIds].forEach(id => {
            const participantWs = room.players[id].ws;
            if (participantWs && participantWs.readyState === WebSocket.OPEN) {
                participantWs.send(JSON.stringify(message));
            }
        });
    }
}

function broadcastRoomMessage(roomId, text) {
    broadcastRoom(roomId, { type: 'message', text: text });
}

/**
 * Broadcasts the current state of a room to all its participants.
 * @param {string} roomId - The ID of the room.
 */
function broadcastRoomState(roomId) {
    const room = rooms[roomId];
    if (room) {
        const playerInfo = room.playerIds.map(id => ({
            id: id,
            name: room.players[id].name,
            score: room.players[id].score,
            ready: room.players[id].ready,
            type: room.players[id].type
        }));
        broadcastRoom(roomId, {
            type: 'room_state',
            count: room.playerIds.length, // Number of actual players
            required: MAX_PLAYERS_PER_ROOM,
            spectatorsCount: room.spectatorIds.length, // Number of spectators
            players: playerInfo, // Info about actual players
            round: room.round,
            readyPlayersCount: room.readyPlayers.size
        });
    }
}

function broadcastRoomChat(roomId, chatMessage) {
    broadcastRoom(roomId, { type: 'chat_message', message: chatMessage });
}

function checkAllPlayersReady(roomId) {
    const room = rooms[roomId];
    if (room && room.playerIds.length === MAX_PLAYERS_PER_ROOM && room.readyPlayers.size === MAX_PLAYERS_PER_ROOM) {
        broadcastRoomMessage(roomId, 'All players ready! Starting new round...');
        startNewRound(roomId);
    }
}

function startNewRound(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.round++;
    resetChoices(roomId);
    room.readyPlayers.clear(); // Reset ready status for new round
    broadcastRoomState(roomId); // Update clients with new round number and reset ready status
    broadcastRoom(roomId, { type: 'start_round', round: room.round, timeLimit: ROUND_TIME_LIMIT });
    broadcastRoomMessage(roomId, `Round ${room.round} begins! Make your choices.`);

    // Start timer for the round
    clearTimeout(room.timer); // Clear any existing timer
    let timeLeft = ROUND_TIME_LIMIT;
    broadcastRoom(roomId, { type: 'timer_update', timeLeft: timeLeft });

    room.timer = setInterval(() => {
        timeLeft--;
        broadcastRoom(roomId, { type: 'timer_update', timeLeft: timeLeft });
        if (timeLeft <= 0) {
            clearInterval(room.timer);
            handleTimeout(roomId);
        }
    }, 1000);
}

function resetChoices(roomId) {
    const room = rooms[roomId];
    if (room) {
        for (let id in room.playerChoices) {
            room.playerChoices[id] = null;
        }
        // Also reset ready status for the next round for actual players
        room.playerIds.forEach(id => {
            if (room.players[id]) {
                room.players[id].ready = false;
            }
        });
        broadcastRoom(roomId, { type: 'reset_choices' }); // Tell clients to re-enable buttons
    }
}

function checkRoundEnd(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const allChoicesMade = room.playerIds.every(id => room.playerChoices[id] !== null);

    if (allChoicesMade && room.playerIds.length === MAX_PLAYERS_PER_ROOM) {
        console.log(`Room ${roomId}: Both players made choices:`, room.playerChoices);
        clearInterval(room.timer); // Stop the timer
        determineWinner(roomId);
    }
}

function handleTimeout(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    console.log(`Room ${roomId}: Round timed out.`);
    let playersWithoutChoice = room.playerIds.filter(id => room.playerChoices[id] === null);

    if (playersWithoutChoice.length === room.playerIds.length) {
        // Both players timed out
        broadcastRoomMessage(roomId, 'Both players timed out! It\'s a tie.');
        room.playerIds.forEach(id => room.players[id].score.ties++);
        broadcastRoom(roomId, {
            type: 'round_result',
            choices: room.playerChoices, // Show null choices
            result: 'Both players timed out! It\'s a tie!',
            winner: null,
            scores: room.playerIds.map(id => ({ id: id, score: room.players[id].score }))
        });
    } else if (playersWithoutChoice.length === 1) {
        // One player timed out, the other wins
        const timedOutPlayerId = playersWithoutChoice[0];
        const winnerId = room.playerIds.find(id => id !== timedOutPlayerId);
        const winnerName = room.players[winnerId].name;
        const timedOutName = room.players[timedOutPlayerId].name;

        room.players[winnerId].score.wins++;
        room.players[timedOutPlayerId].score.losses++;

        const result = `${winnerName} wins as ${timedOutName} timed out!`;
        broadcastRoom(roomId, {
            type: 'round_result',
            choices: room.playerChoices,
            result: result,
            winner: winnerId,
            scores: room.playerIds.map(id => ({ id: id, score: room.players[id].score }))
        });
        broadcastRoomMessage(roomId, result);
    } else {
        // This case should ideally not happen if checkRoundEnd is called correctly
        console.error(`Unexpected timeout scenario in room ${roomId}`);
    }

    // Start a new round after a short delay
    setTimeout(() => {
        broadcastRoomMessage(roomId, 'Starting a new round...');
        startNewRound(roomId);
    }, 3000);
}


function determineWinner(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    const choices = room.playerIds.map(id => room.playerChoices[id]);
    const [choice1, choice2] = choices;
    const [player1Id, player2Id] = room.playerIds;
    const player1Name = room.players[player1Id].name;
    const player2Name = room.players[player2Id].name;

    let result = '';
    let winnerId = null;

    if (choice1 === choice2) {
        result = 'It\'s a tie!';
        room.players[player1Id].score.ties++;
        room.players[player2Id].score.ties++;
    } else if (
        (choice1 === 'rock' && choice2 === 'scissors') ||
        (choice1 === 'paper' && choice2 === 'rock') ||
        (choice1 === 'scissors' && choice2 === 'paper')
    ) {
        result = `${player1Name} wins with ${choice1} against ${choice2}!`;
        winnerId = player1Id;
        room.players[player1Id].score.wins++;
        room.players[player2Id].score.losses++;
    } else {
        result = `${player2Name} wins with ${choice2} against ${choice1}!`;
        winnerId = player2Id;
        room.players[player2Id].score.wins++;
        room.players[player1Id].score.losses++;
    }

    broadcastRoom(roomId, {
        type: 'round_result',
        choices: room.playerChoices,
        result: result,
        winner: winnerId,
        scores: room.playerIds.map(id => ({ id: id, score: room.players[id].score }))
    });

    // Start a new round after a short delay
    setTimeout(() => {
        broadcastRoomMessage(roomId, 'Starting a new round...');
        startNewRound(roomId);
    }, 3000);
}

function resetRound(roomId) {
    const room = rooms[roomId];
    if (room) {
        clearTimeout(room.timer);
        room.round = 0;
        room.readyPlayers.clear();
        for (let id in room.playerChoices) {
            room.playerChoices[id] = null;
        }
        room.playerIds.forEach(id => {
            if (room.players[id]) {
                room.players[id].score = { wins: 0, losses: 0, ties: 0 };
                room.players[id].ready = false;
            }
        });
        broadcastRoomState(roomId);
        broadcastRoom(roomId, { type: 'reset_game' }); // Signal clients to reset their game state
        broadcastRoomMessage(roomId, 'Game reset. Waiting for players to get ready.');
    }
}


server.listen(3000, () => {
    console.log('Server listening on http://localhost:3000');
});
