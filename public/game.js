const socket = io();
let myPlayerId = null;
let gameState = null;

// Check authentication
if (!sessionStorage.getItem('verified')) {
    window.location.href = '/';
}

const nickname = sessionStorage.getItem('nickname');
socket.emit('join', { nickname });

socket.on('gameState', (state) => {
    gameState = state;
    render();
});

socket.on('spectating', (message) => {
    document.getElementById('spectator-message').classList.remove('hidden');
    document.getElementById('betting-controls').classList.add('hidden');
    document.getElementById('action-controls').classList.add('hidden');
});

socket.on('error', (message) => {
    alert(message);
});

function render() {
    if (!gameState) return;
    
    // Render dealer
    renderDealer();
    
    // Render seats
    renderSeats();
    
    // Render controls
    renderControls();
    
    // Render phase
    renderPhase();
    
    // Find my player
    myPlayerId = Object.keys(gameState.players).find(id => id === socket.id);
    
    if (myPlayerId) {
        updatePlayerInfo();
    }
}

function renderDealer() {
    const dealerCards = document.getElementById('dealer-cards');
    const dealerScore = document.getElementById('dealer-score');
    
    dealerCards.innerHTML = '';
    gameState.dealer.cards.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        
        if (index === 0 && gameState.dealer.hiddenCard) {
            cardDiv.classList.add('card-hidden');
            cardDiv.textContent = '??';
        } else {
            cardDiv.textContent = `${card.value}${card.suit}`;
            if (card.suit === '♥' || card.suit === '♦') {
                cardDiv.style.color = '#ff0000';
            }
        }
        dealerCards.appendChild(cardDiv);
    });
    
    if (gameState.dealer.cards.length > 0) {
        dealerScore.textContent = `Score: ${gameState.dealer.score}`;
    } else {
        dealerScore.textContent = '';
    }
}

function renderSeats() {
    const container = document.getElementById('seats-container');
    container.innerHTML = '';
    
    for (let i = 0; i < 4; i++) {
        const seat = document.createElement('div');
        seat.className = 'seat';
        
        const playerId = gameState.seats[i];
        const player = playerId ? gameState.players[playerId] : null;
        
        if (player) {
            seat.classList.add('seat-occupied');
            
            if (playerId === gameState.players[
                Object.keys(gameState.players).find(id => 
                    gameState.seats[gameState.players[id].seatIndex] === id && 
                    id === Object.keys(gameState.players).filter(pid => 
                        gameState.players[pid].bet > 0
                    )[gameState.currentPlayerIndex]
                )
            ]) {
                seat.classList.add('seat-active');
            }
            
            let seatHTML = `
                <div class="seat-nickname">${player.nickname}</div>
                <div class="seat-balance">Balance: ${player.chips.toLocaleString()}</div>
            `;
            
            if (player.bet > 0) {
                seatHTML += `<div class="seat-bet">Bet: ${player.bet.toLocaleString()}</div>`;
            }
            
            if (player.cards && player.cards.length > 0) {
                seatHTML += '<div class="seat-cards">';
                player.cards.forEach(card => {
                    let color = '';
                    if (card.suit === '♥' || card.suit === '♦') {
                        color = 'style="color: #ff0000"';
                    }
                    seatHTML += `<div class="card" ${color}>${card.value}${card.suit}</div>`;
                });
                seatHTML += '</div>';
                
                if (player.busted) {
                    seatHTML += '<div class="seat-score" style="color: #ff4444">BUSTED</div>';
                } else if (player.blackjack) {
                    seatHTML += '<div class="seat-score" style="color: #ffd700">BLACKJACK!</div>';
                } else {
                    seatHTML += `<div class="seat-score">Score: ${player.score}</div>`;
                }
            }
            
            seat.innerHTML = seatHTML;
        } else {
            seat.innerHTML = '<div style="color: #444; text-align: center; padding-top: 50px;">Empty Seat</div>';
        }
        
        container.appendChild(seat);
    }
}

function renderControls() {
    const bettingControls = document.getElementById('betting-controls');
    const actionControls = document.getElementById('action-controls');
    const spectatorMessage = document.getElementById('spectator-message');
    
    const player = myPlayerId ? gameState.players[myPlayerId] : null;
    
    if (!player || player.spectating) {
        bettingControls.classList.add('hidden');
        actionControls.classList.add('hidden');
        spectatorMessage.classList.remove('hidden');
        return;
    }
    
    spectatorMessage.classList.add('hidden');
    
    if (gameState.gamePhase === 'betting') {
        bettingControls.classList.remove('hidden');
        actionControls.classList.add('hidden');
        
        // Disable buttons if player can't afford
        document.querySelectorAll('.chip-btn').forEach(btn => {
            const amount = parseInt(btn.textContent.replace('K', '000'));
            if (amount) {
                btn.disabled = player.chips < amount || player.bet > 0;
            }
        });
    } else if (gameState.gamePhase === 'playing') {
        bettingControls.classList.add('hidden');
        
        const activePlayers = Object.keys(gameState.players).filter(id => 
            gameState.players[id].bet > 0 && !gameState.players[id].busted
        );
        const currentPlayerId = activePlayers[gameState.currentPlayerIndex];
        
        if (myPlayerId === currentPlayerId) {
            actionControls.classList.remove('hidden');
        } else {
            actionControls.classList.add('hidden');
        }
    } else {
        bettingControls.classList.add('hidden');
        actionControls.classList.add('hidden');
    }
}

function renderPhase() {
    const phaseDisplay = document.getElementById('game-phase');
    
    switch(gameState.gamePhase) {
        case 'betting':
            phaseDisplay.textContent = 'PLACE YOUR BETS';
            break;
        case 'playing':
            phaseDisplay.textContent = 'GAME IN PROGRESS';
            break;
        case 'dealerTurn':
            phaseDisplay.textContent = 'DEALER\'S TURN';
            break;
        case 'results':
            phaseDisplay.textContent = 'ROUND COMPLETE';
            break;
    }
}

function updatePlayerInfo() {
    const player = gameState.players[myPlayerId];
    document.getElementById('your-balance').textContent = `Balance: ${player.chips.toLocaleString()} chips`;
    
    if (player.bet > 0) {
        document.getElementById('your-bet').textContent = `Current bet: ${player.bet.toLocaleString()}`;
    } else {
        document.getElementById('your-bet').textContent = '';
    }
}

function placeBet(amount) {
    socket.emit('placeBet', amount);
}

function placeBetAll() {
    const player = gameState.players[myPlayerId];
    const availableChips = [1000, 2000, 5000, 10000].filter(chip => chip <= player.chips);
    if (availableChips.length > 0) {
        socket.emit('placeBet', Math.max(...availableChips));
    }
}

function hit() {
    socket.emit('hit');
}

function stand() {
    socket.emit('stand');
}

// Prevent accidental navigation
window.addEventListener('beforeunload', () => {
    socket.disconnect();
});
