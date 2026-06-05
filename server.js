const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const INVITE_CODE = process.env.INVITE_CODE || 'test123';
const MAX_PLAYERS = 4;
const STARTING_CHIPS = 10000;
const MIN_BET = 1000;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many attempts, try again later' }
});

app.use(express.static('public'));
app.use(express.json());

// Game state
let gameState = {
  players: {},
  seats: [null, null, null, null],
  dealer: { cards: [], score: 0, hiddenCard: null },
  currentPlayerIndex: 0,
  gamePhase: 'betting', // 'betting', 'playing', 'dealerTurn', 'results'
  deck: [],
  currentRound: 0
};

function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  let deck = [];
  
  for (let suit of suits) {
    for (let value of values) {
      deck.push({ suit, value });
    }
  }
  
  return shuffle(deck);
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getCardValue(card) {
  if (['J', 'Q', 'K'].includes(card.value)) return 10;
  if (card.value === 'A') return 11;
  return parseInt(card.value);
}

function calculateScore(cards) {
  let score = 0;
  let aces = 0;
  
  for (let card of cards) {
    if (card.value === 'A') {
      aces++;
      score += 11;
    } else {
      score += getCardValue(card);
    }
  }
  
  while (score > 21 && aces > 0) {
    score -= 10;
    aces--;
  }
  
  return score;
}

function dealCard(deck) {
  return deck.pop();
}

function resetGame() {
  gameState.dealer = { cards: [], score: 0, hiddenCard: null };
  gameState.deck = createDeck();
  gameState.gamePhase = 'betting';
  gameState.currentPlayerIndex = 0;
  gameState.currentRound++;
  
  // Reset player hands
  for (let playerId in gameState.players) {
    gameState.players[playerId].cards = [];
    gameState.players[playerId].score = 0;
    gameState.players[playerId].bet = 0;
    gameState.players[playerId].busted = false;
    gameState.players[playerId].stood = false;
    gameState.players[playerId].blackjack = false;
  }
}

function startRound() {
  if (gameState.gamePhase !== 'betting') return;
  
  const activePlayers = getActivePlayers();
  if (activePlayers.length === 0) return;
  
  gameState.gamePhase = 'playing';
  
  // Deal initial cards
  for (let i = 0; i < 2; i++) {
    for (let playerId of activePlayers) {
      gameState.players[playerId].cards.push(dealCard(gameState.deck));
    }
    if (i === 0) {
      gameState.dealer.cards.push(dealCard(gameState.deck));
    } else {
      gameState.dealer.hiddenCard = dealCard(gameState.deck);
    }
  }
  
  // Calculate scores
  for (let playerId of activePlayers) {
    const player = gameState.players[playerId];
    player.score = calculateScore(player.cards);
    
    if (player.score === 21) {
      player.blackjack = true;
    }
  }
  
  gameState.dealer.score = calculateScore([gameState.dealer.cards[0]]);
  
  // Find first active player
  gameState.currentPlayerIndex = 0;
  
  // If all players have blackjack, skip to results
  const allBlackjack = activePlayers.every(id => gameState.players[id].blackjack);
  if (allBlackjack) {
    dealerTurn();
  }
  
  io.emit('gameState', getPublicGameState());
}

function getActivePlayers() {
  return Object.keys(gameState.players).filter(id => gameState.players[id].bet > 0);
}

function dealerTurn() {
  gameState.gamePhase = 'dealerTurn';
  gameState.dealer.cards.push(gameState.dealer.hiddenCard);
  gameState.dealer.hiddenCard = null;
  gameState.dealer.score = calculateScore(gameState.dealer.cards);
  
  while (gameState.dealer.score < 17) {
    gameState.dealer.cards.push(dealCard(gameState.deck));
    gameState.dealer.score = calculateScore(gameState.dealer.cards);
  }
  
  calculateResults();
  gameState.gamePhase = 'results';
  io.emit('gameState', getPublicGameState());
  
  setTimeout(() => {
    resetGame();
    io.emit('gameState', getPublicGameState());
  }, 5000);
}

function calculateResults() {
  const activePlayers = getActivePlayers();
  
  for (let playerId of activePlayers) {
    const player = gameState.players[playerId];
    
    if (player.blackjack && gameState.dealer.score !== 21) {
      player.chips += Math.floor(player.bet * 2.5); // Blackjack pays 3:2
    } else if (player.busted) {
      // Already lost the bet
    } else if (gameState.dealer.score > 21 || player.score > gameState.dealer.score) {
      player.chips += player.bet * 2;
    } else if (player.score === gameState.dealer.score) {
      player.chips += player.bet; // Push
    }
  }
}

function getPublicGameState() {
  const publicState = {
    seats: gameState.seats,
    dealer: {
      cards: gameState.dealer.cards.map((card, index) => {
        if (gameState.gamePhase !== 'dealerTurn' && gameState.gamePhase !== 'results' && index === 0 && gameState.dealer.cards.length === 1) {
          return card;
        }
        return card;
      }),
      score: gameState.dealer.score,
      hiddenCard: gameState.gamePhase === 'dealerTurn' || gameState.gamePhase === 'results' ? null : true
    },
    gamePhase: gameState.gamePhase,
    currentPlayerIndex: gameState.currentPlayerIndex,
    currentRound: gameState.currentRound
  };
  
  // Add player info for each seat
  const players = {};
  for (let playerId in gameState.players) {
    players[playerId] = {
      id: playerId,
      nickname: gameState.players[playerId].nickname,
      chips: gameState.players[playerId].chips,
      cards: gameState.players[playerId].cards || [],
      score: gameState.players[playerId].score || 0,
      bet: gameState.players[playerId].bet || 0,
      busted: gameState.players[playerId].busted || false,
      blackjack: gameState.players[playerId].blackjack || false
    };
  }
  
  return { ...publicState, players };
}

// Authentication
app.post('/verify', limiter, (req, res) => {
  const { code } = req.body;
  
  if (code === INVITE_CODE) {
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'Invalid invite code' });
  }
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  socket.on('join', (data) => {
    const { nickname } = data;
    
    // Find empty seat
    const seatIndex = gameState.seats.findIndex(seat => seat === null);
    if (seatIndex === -1) {
      socket.emit('error', 'Table is full');
      return;
    }
    
    // If game is in progress, player becomes spectator
    if (gameState.gamePhase !== 'betting' && gameState.gamePhase !== 'results') {
      gameState.players[socket.id] = {
        id: socket.id,
        nickname,
        chips: STARTING_CHIPS,
        seatIndex,
        cards: [],
        score: 0,
        bet: 0,
        busted: false,
        stood: false,
        blackjack: false,
        spectating: true
      };
      socket.emit('spectating', 'Game in progress, you will join next round');
    } else {
      gameState.players[socket.id] = {
        id: socket.id,
        nickname,
        chips: STARTING_CHIPS,
        seatIndex,
        cards: [],
        score: 0,
        bet: 0,
        busted: false,
        stood: false,
        blackjack: false,
        spectating: false
      };
    }
    
    gameState.seats[seatIndex] = socket.id;
    io.emit('gameState', getPublicGameState());
  });
  
  socket.on('placeBet', (amount) => {
      const player = gameState.players[socket.id];
      if (!player || player.spectating) return;
      if (gameState.gamePhase !== 'betting') return;
      if (player.chips < amount) return;
      if (amount < MIN_BET) return;
      if (![1000, 2000, 5000, 10000].includes(amount) && amount % 1000 !== 0) return;
      
      // Allow multiple bets
      player.bet += amount;
      player.chips -= amount;
      
      io.emit('gameState', getPublicGameState());
      
      // Check if all non-spectating players have placed bets
      const nonSpectatingPlayers = Object.keys(gameState.players).filter(id => 
          !gameState.players[id].spectating
      );
      const playersWithBets = nonSpectatingPlayers.filter(id => 
          gameState.players[id].bet >= MIN_BET
      );
      
      if (nonSpectatingPlayers.length > 0 && 
          playersWithBets.length === nonSpectatingPlayers.length) {
          startRound();
      }
  });
  
  socket.on('hit', () => {
    const player = gameState.players[socket.id];
    if (!player || player.spectating) return;
    if (gameState.gamePhase !== 'playing') return;
    
    const activePlayers = getActivePlayers();
    const currentPlayerId = activePlayers[gameState.currentPlayerIndex];
    if (socket.id !== currentPlayerId) return;
    
    player.cards.push(dealCard(gameState.deck));
    player.score = calculateScore(player.cards);
    
    if (player.score > 21) {
      player.busted = true;
      nextPlayer();
    }
    
    io.emit('gameState', getPublicGameState());
  });
  
  socket.on('stand', () => {
    const player = gameState.players[socket.id];
    if (!player || player.spectating) return;
    if (gameState.gamePhase !== 'playing') return;
    
    const activePlayers = getActivePlayers();
    const currentPlayerId = activePlayers[gameState.currentPlayerIndex];
    if (socket.id !== currentPlayerId) return;
    
    player.stood = true;
    nextPlayer();
    
    io.emit('gameState', getPublicGameState());
  });
  
  socket.on('disconnect', () => {
    const player = gameState.players[socket.id];
    if (player) {
      gameState.seats[player.seatIndex] = null;
      delete gameState.players[socket.id];
    }
    io.emit('gameState', getPublicGameState());
  });
});

function nextPlayer() {
  const activePlayers = getActivePlayers();
  gameState.currentPlayerIndex++;
  
  if (gameState.currentPlayerIndex >= activePlayers.length) {
    dealerTurn();
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
