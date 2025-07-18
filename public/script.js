const statusMessage = document.getElementById('status-message');
const playerIdDisplay = document.getElementById('player-id-display');
const roomIdDisplay = document.getElementById('room-id-display');
const choiceButtons = document.getElementById('choice-buttons');
const roundInfo = document.getElementById('round-info');
const player1ChoiceDisplay = document.getElementById('player1-choice');
const player2ChoiceDisplay = document.getElementById('player2-choice');
const roundWinnerDisplay = document.getElementById('round-winner');
const playerCountDisplay = document.getElementById('player-count');
const spectatorCountDisplay = document.getElementById('spectator-count'); // New element
const roundCounterDisplay = document.getElementById('round-counter');
const timerDisplay = document.getElementById('timer-display');

const playerNameInput = document.getElementById('player-name-input');
const roomIdInput = document.getElementById('room-id-input');
const joinRoomButton = document.getElementById('join-room-button');
const createRoomButton = document.getElementById('create-room-button');
const joinSpectatorButton = document.getElementById('join-spectator-button'); // New button
const roomEntryDiv = document.getElementById('room-entry');
const gameAreaDiv = document.getElementById('game-area');
const readyButton = document.getElementById('ready-button');

const player1NameDisplay = document.getElementById('player1-name');
const player2NameDisplay = document.getElementById('player2-name');
const player1ScoreDisplay = document.getElementById('player1-score');
const player2ScoreDisplay = document = document.getElementById('player2-score');
const player1ReadyStatus = document.getElementById('player1-ready');
const player2ReadyStatus = document.getElementById('player2-ready');

const chatMessagesDiv = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatButton = document.getElementById('send-chat-button');


let ws;
let myPlayerId = null;
let myPlayerName = null;
let myRoomId = null;
let isSpectator = false; // New flag to track if current user is a spectator
let currentPlayersInRoom = {}; // { playerId: { name, score, ready, type } }
let isReady = false;

// --- Room Entry Logic ---
createRoomButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (!playerName) {
        statusMessage.textContent = 'Please enter your name.';
        return;
    }

    myPlayerName = playerName;
    myRoomId = generateRoomId(); // Generate a unique room ID
    roomIdInput.value = myRoomId; // Display the generated ID to the user

    isSpectator = false; // Ensure this is false for players
    connectWebSocket();
});


joinRoomButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase(); // Normalize room ID

    if (!playerName) {
        statusMessage.textContent = 'Please enter your name.';
        return;
    }
    if (!roomId) {
        statusMessage.textContent = 'Please enter a room ID to join.';
        return;
    }

    myPlayerName = playerName;
    myRoomId = roomId;

    isSpectator = false; // Ensure this is false for players
    connectWebSocket();
});

// New event listener for "Join as Spectator" button
joinSpectatorButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase(); // Normalize room ID

    if (!playerName) {
        statusMessage.textContent = 'Please enter your name.';
        return;
    }
    if (!roomId) {
        statusMessage.textContent = 'Please enter a room ID to spectate.';
        return;
    }

    myPlayerName = playerName;
    myRoomId = roomId;
    isSpectator = true; // Set spectator flag

    connectWebSocket();
});


function generateRoomId() {
    // Generate a random 6-character alphanumeric string for the room ID
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}


// --- WebSocket Connection ---
function connectWebSocket() {
    ws = new WebSocket('ws://localhost:3000'); // Connect to your Node.js server

    ws.onopen = () => {
        statusMessage.textContent = 'Connected to game server! Joining room...';
        // Send join room message with player name, room ID, and type (player/spectator)
        ws.send(JSON.stringify({
            type: isSpectator ? 'join_spectator_room' : 'join_room',
            roomId: myRoomId,
            playerName: myPlayerName
        }));
        roomEntryDiv.classList.add('hidden');
        gameAreaDiv.classList.remove('hidden');
        roomIdDisplay.textContent = `Room ID: ${myRoomId}`;

        // Disable interactive elements if spectator
        if (isSpectator) {
            enableChoiceButtons(false);
            readyButton.classList.add('hidden'); // Hide ready button for spectators
            chatInput.disabled = true;
            sendChatButton.disabled = true;
            statusMessage.textContent = `Joined as Spectator in room ${myRoomId}.`;
        } else {
            enableChoiceButtons(false); // Disable until game starts for players
            readyButton.classList.remove('hidden'); // Show ready button for players
            chatInput.disabled = false;
            sendChatButton.disabled = false;
        }
    };

    ws.onmessage = event => {
        const data = JSON.parse(event.data);
        console.log('Received:', data);

        switch (data.type) {
            case 'player_id':
                myPlayerId = data.id;
                myPlayerName = data.name; // Use the name confirmed by server
                playerIdDisplay.textContent = `Your Player ID: ${myPlayerId} (${myPlayerName})`;
                break;
            case 'message':
                statusMessage.textContent = data.text;
                break;
            case 'room_state':
                updateRoomState(data);
                break;
            case 'start_round':
                roundCounterDisplay.textContent = `Round: ${data.round}`;
                statusMessage.textContent = `Round ${data.round} begins! Make your choices.`;
                if (!isSpectator) { // Only enable for players
                    enableChoiceButtons(true);
                    readyButton.textContent = 'Ready'; // Reset ready button text
                    isReady = false;
                    readyButton.disabled = false; // Enable ready button
                }
                hideRoundResult();
                timerDisplay.textContent = `Time Left: ${data.timeLimit}s`; // Initial timer display
                break;
            case 'round_result':
                displayRoundResult(data.choices, data.result, data.winner, data.scores);
                if (!isSpectator) { // Only disable for players
                    enableChoiceButtons(false); // Disable after choices, wait for next round
                }
                break;
            case 'reset_choices':
                // This is now handled by 'start_round' which resets UI and enables buttons
                break;
            case 'reset_game':
                // Reset client-side game state
                roundCounterDisplay.textContent = 'Round: 0';
                timerDisplay.textContent = 'Time Left: --s';
                player1ScoreDisplay.textContent = 'W:0 L:0 T:0';
                player2ScoreDisplay.textContent = 'W:0 L:0 T:0';
                hideRoundResult();
                if (!isSpectator) { // Only affect players
                    enableChoiceButtons(false);
                    readyButton.textContent = 'Ready';
                    isReady = false;
                    readyButton.disabled = false;
                }
                break;
            case 'timer_update':
                timerDisplay.textContent = `Time Left: ${data.timeLeft}s`;
                if (data.timeLeft <= 5 && data.timeLeft > 0) {
                    timerDisplay.style.color = 'red';
                } else {
                    timerDisplay.style.color = ''; // Reset color
                }
                break;
            case 'chat_message':
                displayChatMessage(data.message);
                break;
            case 'chat_history':
                data.history.forEach(msg => displayChatMessage(msg));
                break;
        }
    };

    ws.onclose = () => {
        statusMessage.textContent = 'Disconnected from server. Please refresh to rejoin.';
        playerIdDisplay.textContent = 'Your Player ID: N/A';
        roomIdDisplay.textContent = 'Room ID: N/A';
        playerCountDisplay.textContent = 'Players: 0/2';
        spectatorCountDisplay.textContent = 'Spectators: 0';
        roundCounterDisplay.textContent = 'Round: 0';
        timerDisplay.textContent = 'Time Left: --s';
        enableChoiceButtons(false);
        readyButton.classList.add('hidden');
        gameAreaDiv.classList.add('hidden');
        roomEntryDiv.classList.remove('hidden');
        chatInput.disabled = true;
        sendChatButton.disabled = true;
        isSpectator = false; // Reset spectator flag on disconnect
        // Do not attempt to reconnect automatically for now, let user manually rejoin
    };

    ws.onerror = error => {
        console.error('WebSocket Error:', error);
        statusMessage.textContent = 'Connection error. Check server console.';
    };
}

// --- Game Logic ---
choiceButtons.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
        const choice = button.dataset.choice;
        if (ws && ws.readyState === WebSocket.OPEN && !isSpectator) { // Only allow if not spectator
            ws.send(JSON.stringify({ type: 'choice', choice: choice }));
            statusMessage.textContent = `You chose ${choice}. Waiting for opponent...`;
            enableChoiceButtons(false); // Disable buttons after making a choice
        }
    });
});

readyButton.addEventListener('click', () => {
    isReady = !isReady;
    if (ws && ws.readyState === WebSocket.OPEN && !isSpectator) { // Only allow if not spectator
        ws.send(JSON.stringify({ type: 'ready', isReady: isReady }));
        readyButton.textContent = isReady ? 'Unready' : 'Ready';
        readyButton.disabled = true; // Disable until server acknowledges or new round starts
    }
});

function enableChoiceButtons(enable) {
    choiceButtons.querySelectorAll('button').forEach(button => {
        button.disabled = !enable;
        if (enable) {
            button.classList.remove('disabled');
        } else {
            button.classList.add('disabled');
        }
    });
}

function updateRoomState(data) {
    playerCountDisplay.textContent = `Players: ${data.count}/${data.required}`;
    spectatorCountDisplay.textContent = `Spectators: ${data.spectatorsCount}`; // Update spectator count
    roundCounterDisplay.textContent = `Round: ${data.round}`;

    currentPlayersInRoom = {};
    data.players.forEach(p => {
        currentPlayersInRoom[p.id] = p;
    });

    const playerIds = Object.keys(currentPlayersInRoom).filter(id => currentPlayersInRoom[id].type === 'player');
    const p1 = currentPlayersInRoom[playerIds[0]];
    const p2 = currentPlayersInRoom[playerIds[1]];

    // Update player 1 display
    if (p1) {
        player1NameDisplay.textContent = p1.name;
        player1ScoreDisplay.textContent = `W:${p1.score.wins} L:${p1.score.losses} T:${p1.score.ties}`;
        player1ReadyStatus.textContent = p1.ready ? '✅' : '❌';
    } else {
        player1NameDisplay.textContent = 'Waiting...';
        player1ScoreDisplay.textContent = 'W:0 L:0 T:0';
        player1ReadyStatus.textContent = '❌';
    }

    // Update player 2 display
    if (p2) {
        player2NameDisplay.textContent = p2.name;
        player2ScoreDisplay.textContent = `W:${p2.score.wins} L:${p2.score.losses} T:${p2.score.ties}`;
        player2ReadyStatus.textContent = p2.ready ? '✅' : '❌';
    } else {
        player2NameDisplay.textContent = 'Waiting...';
        player2ScoreDisplay.textContent = 'W:0 L:0 T:0';
        player2ReadyStatus.textContent = '❌';
    }

    // Only for actual players: Ensure current player's ready button state is correct
    if (!isSpectator) {
        if (currentPlayersInRoom[myPlayerId] && currentPlayersInRoom[myPlayerId].ready !== isReady) {
            isReady = currentPlayersInRoom[myPlayerId].ready;
            readyButton.textContent = isReady ? 'Unready' : 'Ready';
        }
        // Re-enable ready button if not all players are ready yet
        if (data.readyPlayersCount < data.required) {
            readyButton.disabled = false;
        } else {
            readyButton.disabled = true; // All players are ready, disable until next round starts
        }
    }


    if (data.count === data.required && data.round === 0) {
        statusMessage.textContent = 'Both players connected! Click "Ready" to start the game.';
    } else if (data.count < data.required) {
        statusMessage.textContent = `Waiting for ${data.required - data.count} more player(s)...`;
    }
}


function displayRoundResult(choices, result, winnerId, scores) {
    const playerIds = Object.keys(choices);
    const p1Id = playerIds[0];
    const p2Id = playerIds[1];

    const p1Name = currentPlayersInRoom[p1Id] ? currentPlayersInRoom[p1Id].name : 'Player 1';
    const p2Name = currentPlayersInRoom[p2Id] ? currentPlayersInRoom[p2Id].name : 'Player 2';

    const p1Choice = choices[p1Id] || 'No choice';
    const p2Choice = choices[p2Id] || 'No choice';

    player1ChoiceDisplay.textContent = `${p1Name} chose: ${p1Choice}`;
    player2ChoiceDisplay.textContent = `${p2Name} chose: ${p2Choice}`;

    roundWinnerDisplay.textContent = result;
    roundInfo.classList.remove('hidden');

    // Update scores
    scores.forEach(s => {
        if (s.id === p1Id) {
            player1ScoreDisplay.textContent = `W:${s.score.wins} L:${s.score.losses} T:${s.score.ties}`;
        } else if (s.id === p2Id) {
            player2ScoreDisplay.textContent = `W:${s.score.wins} L:${s.score.losses} T:${s.score.ties}`;
        }
    });

    // Add a quick animation for the result
    roundInfo.style.opacity = 0;
    setTimeout(() => {
        roundInfo.style.transition = 'opacity 0.5s ease-in-out';
        roundInfo.style.opacity = 1;
    }, 50);
}

function hideRoundResult() {
    roundInfo.classList.add('hidden');
    roundInfo.style.opacity = 0; // Reset opacity for next animation
    player1ChoiceDisplay.textContent = '';
    player2ChoiceDisplay.textContent = '';
    roundWinnerDisplay.textContent = '';
}

// --- Chat Functionality ---
sendChatButton.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendChatMessage();
    }
});

function sendChatMessage() {
    const messageText = chatInput.value.trim();
    if (messageText && ws && ws.readyState === WebSocket.OPEN && !isSpectator) { // Only allow if not spectator
        ws.send(JSON.stringify({ type: 'chat_message', text: messageText }));
        chatInput.value = ''; // Clear input field
    }
}

function displayChatMessage(message) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message');
    messageElement.innerHTML = `<strong>[${message.timestamp}] ${message.sender}:</strong> ${message.text}`;
    chatMessagesDiv.appendChild(messageElement);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight; // Scroll to the bottom of the chat
}

// Initial state (room entry visible) - This line is not needed here as the HTML structure handles initial visibility.
// roomEntryDiv.classList.remove('hidden');
// gameAreaDiv.classList.add('hidden');
