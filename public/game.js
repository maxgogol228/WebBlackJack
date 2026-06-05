const socket = io();
let myPlayerId = null;
let gameState = null;
let pendingBet = 0;

// Check authentication
if (!sessionStorage.getItem('verified')) {
    window.location.href = '/';
}

const nickname = sessionStorage.getItem('nickname');
socket.emit('join', { nickname });

socket.on('gameState', (state) => {
    gameState = state;
    myPlayerId = socket.id;
    render();
});

socket.on('spectating', (message) => {
    document.getElementById('spectator-message').classList.remove('hidden');
    document.getElementById('chips-area').classList.add('hidden');
    document.getElementById('action-controls').classList.add('hidden');
    showMessage(message);
});

socket.on('error', (message) => {
    showMessage(message, 'error');
});

function render() {
    if (!gameState) return;
    
    renderDealer();
    renderSeats();
    renderControls();
    renderPhase();
    updatePlayerInfo();
    renderChips();
}

function renderDealer() {
    const dealerCards = document.getElementById('dealer-cards');
    const dealerScore = document.getElementById('dealer-score');
    
    dealerCards.innerHTML = '';
    
    if (gameState.dealer.cards.length === 0) {
        dealerCards.innerHTML = '<div style="color: #444;">Waiting for players...</div>';
        dealerScore.textContent = '';
        return;
    }
    
    gameState.dealer.cards.forEach((card, index) => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'card';
        
        if (index === 0 && gameState.dealer.hiddenCard) {
            cardDiv.classList.add('card-hidden');
            cardDiv.textContent = '?';
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
            
            // Highlight active player
            const activePlayers = Object.keys(gameState.players).filter(id => 
                gameState.players[id].bet > 0 && 
                !gameState.players[id].busted && 
                !gameState.players[id].stood
            );
            const currentPlayerId = activePlayers[gameState.currentPlayerIndex];
            
            if (playerId === currentPlayerId && gameState.gamePhase === 'playing') {
                seat.classList.add('seat-active');
            }
            
            if (playerId === myPlayerId) {
                seat.classList.add('seat-mine');
            }
            
            let seatHTML = `
                <div class="seat-nickname">${player.nickname}${playerId === myPlayerId ? ' (YOU)' : ''}</div>
                <div class="seat-balance">💰 ${player.chips.toLocaleString()}</div>
            `;
            
            // Show bet
            if (player.bet > 0) {
                seatHTML += `<div class="seat-bet">Bet: ${player.bet.toLocaleString()}</div>`;
            }
            
            // Show cards
            if (player.cards && player.cards.length > 0) {
                seatHTML += '<div class="seat-cards">';
                player.cards.forEach(card => {
                    let color = '';
                    if (card.suit === '♥' || card.suit === '♦') {
                        color = 'style="color: #ff0000"';
                    }
                    seatHTML += `<div class="card small-card" ${color}>${card.value}${card.suit}</div>`;
                });
                seatHTML += '</div>';
                
                if (player.busted) {
                    seatHTML += '<div class="seat-score busted">BUSTED</div>';
                } else if (player.blackjack) {
                    seatHTML += '<div class="seat-score blackjack">BLACKJACK!</div>';
                } else if (player.stood) {
                    seatHTML += `<div class="seat-score">Stand (${player.score})</div>`;
                } else {
                    seatHTML += `<div class="seat-score">Score: ${player.score}</div>`;
                }
            }
            
            seat.innerHTML = seatHTML;
        } else {
            seat.innerHTML = `
                <div class="empty-seat">
                    <div class="seat-number">SEAT ${i + 1}</div>
                    <div class="empty-text">Available</div>
                </div>
            `;
        }
        
        container.appendChild(seat);
    }
}

function renderChips() {
    const player = myPlayerId ? gameState.players[myPlayerId] : null;
    const chipsArea = document.getElementById('chips-area');
    const chipsContainer = document.getElementById('chips-container');
    
    if (!player || player.spectating) {
        chipsArea.classList.add('hidden');
        return;
    }
    
    if (gameState.gamePhase === 'betting' && player.bet === 0) {
        chipsArea.classList.remove('hidden');
        
        const chips = [
            { value: 1000, color: 'green', label: '1K' },
            { value: 2000, color: 'blue', label: '2K' },
            { value: 5000, color: 'orange', label: '5K' },
            { value: 10000, color: 'red', label: '10K' },
            { value: 'all', color: 'gold', label: 'ALL IN' }
        ];
        
        chipsContainer.innerHTML = '';
        
        chips.forEach(chip => {
            const chipDiv = document.createElement('div');
            chipDiv.className = `chip ${chip.color}-chip`;
            
            if (chip.value === 'all') {
                chipDiv.classList.add('all-in-chip');
                const availableChips = [1000, 2000, 5000, 10000].filter(c => c <= player.chips);
                if (availableChips.length === 0 || player.chips < 1000) {
                    chipDiv.classList.add('chip-disabled');
                }
            } else if (player.chips < chip.value) {
                chipDiv.classList.add('chip-disabled');
            }
            
            chipDiv.innerHTML = `
                <div class="chip-value">${chip.label}</div>
                ${chip.value !== 'all' ? `<div class="chip-amount">${chip.value.toLocaleString()}</div>` : ''}
            `;
            
            chipDiv.addEventListener('click', () => {
                if (chip.value === 'all') {
                    placeBetAll();
                } else if (player.chips >= chip.value) {
                    addToBet(chip.value);
                }
            });
            
            chipsContainer.appendChild(chipDiv);
        });
        
        updateBetDisplay();
    } else {
        chipsArea.classList.add('hidden');
    }
}

function addToBet(amount) {
    const player = gameState.players[myPlayerId];
    if (!player || gameState.gamePhase !== 'betting') return;
    
    if (player.chips >= amount) {
        pendingBet += amount;
        player.chips -= amount;
        updateBetDisplay();
        updatePlayerInfo();
        renderChips();
    }
}

function clearBet() {
    const player = gameState.players[myPlayerId];
    if (!player) return;
    
    player.chips += pendingBet;
    pendingBet = 0;
    updateBetDisplay();
    updatePlayerInfo();
    renderChips();
}

function confirmBet() {
    if (pendingBet >= 1000) {
        socket.emit('placeBet', pendingBet);
        pendingBet = 0;
        updateBetDisplay();
        renderChips();
    }
}

function updateBetDisplay() {
    const betControls = document.getElementById('bet-controls');
    const clearBtn = document.getElementById('clear-bet-btn');
    const confirmBtn = document.getElementById('confirm-bet-btn');
    
    if (pendingBet > 0) {
        clearBtn.disabled = false;
        confirmBtn.disabled = pendingBet < 1000;
        document.getElementById('your-bet').textContent = `Pending bet: ${pendingBet.toLocaleString()} chips`;
        document.getElementById('your-bet').style.color = '#4CAF50';
    } else {
        clearBtn.disabled = true;
        confirmBtn.disabled = true;
        document.getElementById('your-bet').textContent = '';
    }
}

function placeBet(amount) {
    const player = gameState.players[myPlayerId];
    if (!player || gameState.gamePhase !== 'betting') return;
    
    if (player.chips >= amount) {
        socket.emit('placeBet', amount);
    }
}

function placeBetAll() {
    const player = gameState.players[myPlayerId];
    const availableChips = [1000, 2000, 5000, 10000].filter(chip => chip <= player.chips);
    if (availableChips.length > 0) {
        pendingBet += availableChips[0];
        player.chips -= availableChips[0];
        updateBetDisplay();
        updatePlayerInfo();
        renderChips();
    }
}

function renderControls() {
    const actionControls = document.getElementById('action-controls');
    const spectatorMessage = document.getElementById('spectator-message');
    const chipsArea = document.getElementById('chips-area');
    
    const player = myPlayerId ? gameState.players[myPlayerId] : null;
    
    if (!player || player.spectating) {
        chipsArea.classList.add('hidden');
        actionControls.classList.add('hidden');
        spectatorMessage.classList.remove('hidden');
        return;
    }
    
    spectatorMessage.classList.add('hidden');
    
    if (gameState.gamePhase === 'playing') {
        chipsArea.classList.add('hidden');
        
        const activePlayers = Object.keys(gameState.players).filter(id => 
            gameState.players[id].bet > 0 && 
            !gameState.players[id].busted && 
            !gameState.players[id].stood
        );
        const currentPlayerId = activePlayers[gameState.currentPlayerIndex];
        
        if (myPlayerId === currentPlayerId) {
            actionControls.classList.remove('hidden');
        } else {
            actionControls.classList.add('hidden');
        }
    } else {
        actionControls.classList.add('hidden');
    }
}

function renderPhase() {
    const phaseDisplay = document.getElementById('game-phase');
    
    switch(gameState.gamePhase) {
        case 'betting':
            phaseDisplay.textContent = '🎲 PLACE YOUR BETS';
            phaseDisplay.style.color = '#4CAF50';
            break;
        case 'playing':
            phaseDisplay.textContent = '🎯 GAME IN PROGRESS';
            phaseDisplay.style.color = '#FF9800';
            break;
        case 'dealerTurn':
            phaseDisplay.textContent = '🃏 DEALER\'S TURN';
            phaseDisplay.style.color = '#2196F3';
            break;
        case 'results':
            phaseDisplay.textContent = '💰 ROUND COMPLETE';
            phaseDisplay.style.color = '#FFD700';
            break;
    }
}

function updatePlayerInfo() {
    const player = myPlayerId ? gameState.players[myPlayerId] : null;
    if (!player) return;
    
    document.getElementById('your-balance').textContent = 
        `💰 Your Balance: ${player.chips.toLocaleString()} chips`;
    
    if (player.bet > 0 && pendingBet === 0) {
        document.getElementById('your-bet').textContent = `Bet placed: ${player.bet.toLocaleString()} chips`;
        document.getElementById('your-bet').style.color = '#FFD700';
    }
}

function showMessage(msg, type = 'info') {
    const messageArea = document.getElementById('message-area');
    messageArea.textContent = msg;
    messageArea.className = `message ${type}`;
    messageArea.style.display = 'block';
    
    setTimeout(() => {
        messageArea.style.display = 'none';
    }, 3000);
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
