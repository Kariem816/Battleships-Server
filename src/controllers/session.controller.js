const MAX_SIZE = 10;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const GRID_ROWS = 10;
const GRID_COLS = 10;

function generateRoomId() {
    let id = "";
    for (let i = 0; i < 4; i++) {
        id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return id;
}

function locationToCell({ x, y }) {
    return x + y * GRID_COLS
}

function deepCompareArrays(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i] !== arr2[i]) return false;
    }
    return true;
}

class Controller {
    constructor() {
        this.users = {};
        this.games = {};
    }

    get userCount() {
        return Object.keys(this.users).length;
    }

    get gameCount() {
        return Object.keys(this.games).length;
    }

    addUser(userId) {
        this.users[userId] = new User(userId);
    }

    removeUser(id) {
        const user = this.getUser(id);
        if (!user) return
        if (user.game) this.leaveGame(id);
        delete this.users[id];
    }

    disconnectUser(id) {
        const user = this.getUser(id);
        if (!user) throw new Error("User does not exist");
        user.disconnect(setTimeout(() => {
            this.removeUser(id);
        }, 1000));
    }

    reconnectUser(id, username) {
        const user = this.getUserByUsername(username);
        if (!user) throw new Error("User does not exist");
        const oldId = user.id;
        user.reconnect(id);
        if (user.game) {
            const game = this.getGame(user.game);
            game.reconnectUser(oldId, user);
        }
        this.users[id] = user;
        delete this.users[oldId];
    }

    getUser(id) {
        return this.users[id];
    }

    getUserByUsername(username) {
        return Object.values(this.users).find((user) => user.username === username);
    }

    login(id, username) {
        const user = this.getUser(id);
        if (!user) throw new Error("User does not exist");
        if (user.username) throw new Error("User is already logged in");
        if (!username.trim()) throw new Error("Username is required");
        const oldUser = this.getUserByUsername(username);
        if (oldUser) {
            if (!oldUser.disconnected) throw new Error("Username is already taken");
            if (oldUser.disconnected) {
                this.reconnectUser(id, username);
                return;
            }
        }
        user.setUsername(username);
    }

    logout(id) {
        const user = this.getUser(id);
        if (!user) throw new Error("User does not exist");
        if (!user.username) throw new Error("User is not logged in");
        user.resetUsername();
    }

    getGame(id) {
        return this.games[id];
    }

    createGame(userId, { type = "public", size = MAX_SIZE }) {
        const user = this.getUser(userId);
        if (!user.username) throw new Error("Login to host a game");
        if (user.game) throw new Error("User is already in a game");
        let id = generateRoomId();
        while (this.getGame(id)) id = generateRoomId();
        this.games[id] = new Game(id, user, type, size);
        return id;
    }

    joinGame(userId, id) {
        const user = this.getUser(userId);
        if (!user.username) throw new Error("Login to join a game");
        if (user.game) throw new Error("User is already in a game");
        const game = this.getGame(id);
        if (!game) throw new Error("Game does not exist");
        if (game.isFull()) throw new Error("Game is full");
        game.addUser(user);
        return game.id;
    }

    leaveGame(userId) {
        const user = this.getUser(userId);
        if (!user.game) return
        const game = this.getGame(user.game);
        if (!game) throw new Error("Game does not exist");
        game.removeUser(user);
        user.leaveGame()
        const gameId = game.id
        if (game.userCount === 0) {
            delete this.games[game.id];
        }
        return gameId
    }

    getPublicGames() {
        const games = Object.values(this.games).filter((game) => game.isPublic);
        if (games.length === 0) return [];
        return games.map((game) => ({
            id: game.id,
            host: game.host.username,
            size: game.size,
            userCount: game.userCount,
            started: game.state !== "idle"
        }));
    }

    getCellName(cell) {
        const row = alphabet[cell % 10]
        const col = Math.floor(cell / 10) + 1
        return `${row}${col}`
    }

    handleAction(action, id, data) {
        // getting info
        const user = this.getUser(id);
        const game = this.getGame(user.game);

        // handle actions
        if (action === "new-player") {
            game.addPlayer(user)
            return {
                how: "broadcast",
                room: game.id,
                data: {
                    action: "new-player",
                    data: game
                },
                sendMessage: `${user.username} is now a player`
            }
        } else if (action === "remove-player") {
            game.removePlayer(user)
            return {
                how: "broadcast",
                room: game.id,
                data: {
                    action: "remove-player",
                    data: game
                },
                sendMessage: `${user.username} is no longer a player`
            }
        } else if (action === "start-game") {
            game.start()
            return {
                how: "broadcast",
                room: game.id,
                data: {
                    action: "game-started",
                    data: game
                },
                sendMessage: "Place your ships"
            }
        } else if (action === "cancel") {
            const data = this.handleCancelGame(game.id)
            const game = this.getGame(game.id)
            if (!game) return
            delete this.games[game.id]
            return {
                how: "room",
                room: game.id,
                data: {
                    action: "canceled",
                    data: "game-canceled"
                },
                sendMessage: "Game canceled"
            }
        } else if (action === "ready") {
            game.readyPlayer(user, data)
            return {
                how: "broadcast",
                room: game.id,
                data: {
                    action: "ready",
                    data: game
                },
                sendMessage: `${user.username} is ready`
            }
        } else if (action === "unready") {
            game.unreadyPlayer(id)
            return {
                how: "broadcast",
                room: game.id,
                data: {
                    action: "ready",
                    data: game
                },
                sendMessage: `${user.username} is no longer ready`
            }
        } else if (action === "start-attack") {
            if (game.host.id !== user.id) throw new Error("You are not the host")
            if (game.state !== "setup") throw new Error("Game is not in setup state")
            if (!game.allReady) throw new Error("All players must be ready to start")
            game.startPlaying()
            return {
                how: "broadcast",
                room: game.id,
                data: {
                    action: "attack-started",
                    data: game
                },
                sendMessage: "Game started"
            }
        } else if (action === "attack") {
            const { result } = game.attack(user, data.cell)
            if (game.winner) {
                return {
                    how: "broadcast",
                    room: game.id,
                    data: {
                        action: "attacked",
                        data: { game, result }
                    },
                    sendMessage: `${user.username} wins the game`
                }
            }
            let message = ""
            if (result === "miss") {
                message = "missed"
            } else if (result === "hit") {
                message = "got a hit"
            } else if (result === "destroyed") {
                message = "destroyed a ship"
            }
            return {
                how: "broadcast",
                room: game.id,
                data: {
                    action: "attacked",
                    data: { game, result }
                },
                sendMessage: `${user.username} attacked ${this.getCellName(data.cell)} and ${message}`
            }
        } else if (action === "play-again") {
            if (!game.isHost(user)) throw new Error("You are not the host")
            game.playAgain(id)
            return {
                how: "broadcast",
                room: game.id,
                data: {
                    action: "attack-started",
                    data: game
                },
                sendMessage: "Game started again"
            }
        } else {
            throw new Error("Action not supported")
        }
    }
}

class User {
    constructor(id) {
        this.id = id;
        this.username = null;
        this.game = null;
        this.disconnected = false;
        this.deleteTimeout = null;
    }

    joinGame(game) {
        this.game = game;
    }

    leaveGame() {
        this.game = null;
    }

    setUsername(username) {
        this.username = username;
    }

    resetUsername() {
        this.username = null;
    }

    get inGame() {
        return this.game !== null;
    }

    disconnect(timeout) {
        this.disconnected = true;
        this.deleteTimeout = timeout;
    }

    reconnect(newId) {
        clearTimeout(this.deleteTimeout);
        this.deleteTimeout = null;
        this.disconnected = false;
        this.id = newId;
    }
}

const GAME_STATES = ["idle", "setup", "playing", "finished"]

class Game {
    constructor(id, user, type, size) {
        if (size < 2 || size > MAX_SIZE) throw new Error("Invalid game size");
        if (!["public", "private"].includes(type)) throw new Error("Invalid game type");

        user.joinGame(id);

        this.id = id;
        this.type = type;
        this.size = size;
        this.host = user;
        this.users = [user];

        this.state = "idle";
        this.players = [];
        this.turn = null;
        this.winner = null;

        this.pastWinner = null;
    }

    get userCount() {
        return this.users.length;
    }

    get playerCount() {
        return this.players.length;
    }

    get isPublic() {
        return this.type === "public";
    }

    addUser(user) {
        if (this.isFull()) throw new Error("Game is full");
        if (this.users.includes(user)) throw new Error("User is already in game");
        user.joinGame(this.id);
        this.users.push(user);
    }

    removeUser(user) {
        if (!this.users.includes(user)) throw new Error("User is not in game");
        user.leaveGame();
        this.users = this.users.filter((u) => u.id !== user.id);
        if (this.isHost(user)) {
            this.host = this.users[0];
        }
        if (this.players.some((player) => player.user.id === user.id)) {
            this.state = "idle";
            this.removePlayer(user);
        }
    }

    isFull() {
        return this.userCount >= this.size;
    }

    isHost(user) {
        return this.host.id === user.id;
    }

    addPlayer(user) {
        if (this.state !== "idle") throw new Error("Game is not in idle state");
        if (this.playerCount >= 2) throw new Error("Maximum number of players reached");
        this.players.push(new Player(user));
    }

    removePlayer(user) {
        if (this.state !== "idle") throw new Error("Game is not in idle state");
        this.players = this.players.filter((player) => player.user.id !== user.id);
    }

    changeTurn() {
        if (this.state !== "playing") throw new Error("Game is not in playing state");
        const index = this.players.findIndex((player) => player.user.id === this.turn);
        const nextPlayer = this.players[(index + 1) % this.players.length];
        this.turn = nextPlayer.user.id;
    }

    start() {
        if (this.state !== "idle") throw new Error("Game is already started");
        if (this.playerCount < 2) throw new Error("Not enough players");
        this.state = "setup";
    }

    get allReady() {
        return this.players.every((player) => player.ready);
    }

    startPlaying() {
        if (this.state !== "setup") throw new Error("Game is not in setup state");
        if (!this.allReady) throw new Error("Not all players are ready");
        this.state = "playing";
        const pastWinnerPlaying = this.pastWinner && this.players.some((player) => player.user.id === this.pastWinner);
        this.turn = pastWinnerPlaying ? this.pastWinner : this.players[0].user.id;
    }

    attack(user, cell) {
        if (this.state !== "playing") throw new Error("Game is not in playing state");
        if (this.turn !== user.id) throw new Error("Not your turn");
        const target = this.players.find((player) => player.user.id !== user.id);
        const { result } = target.board.attack(cell);
        if (result === "miss") {
            this.changeTurn();
        }
        if (target.board.allDestroyed) {
            this.finish(this.turn);
        }
        return { result };
    }

    finish(winner) {
        if (this.state !== "playing") throw new Error("Game is not in playing state");
        this.state = "finished";
        this.winner = winner;
        this.pastWinner = winner;
    }

    playAgain() {
        if (this.state !== "finished") throw new Error("Game is not in finished state");
        this.state = "idle";
        this.winner = null;
        this.players = [];
    }

    readyPlayer(user, ships) {
        if (this.state !== "setup") throw new Error("Game is not in setup state");
        const player = this.players.find((player) => player.user.id === user.id);
        if (!player) {
            if (this.users.find((u) => u.id === user.id)) {
                throw new Error("You are not a player");
            }
            throw new Error("Player not found");
        }
        player.setReady(ships);
    }

    unreadyPlayer(userId) {
        if (this.state !== "setup") throw new Error("Game is not in setup state");
        const player = this.players.find((player) => player.user.id === userId);
        if (!player) {
            if (this.users.find((u) => u.id === userId)) {
                throw new Error("You are not a player");
            }
            throw new Error("Player not found");
        }
        player.unready();
    }

    reconnectUser(oldId, user) {
        const player = this.players.find((player) => player.user.id === oldId);
        if (!player) return;
        player.user = user;
    }
}

class Player {
    constructor(user) {
        this.user = user;
        this.board = new Board();
        this.ready = false;
    }

    setReady(ships) {
        this.board.addShips(ships);
        this.ready = true;
    }

    unready() {
        this.board.clearShips();
        this.ready = false;
    }
}

class Board {
    constructor() {
        this.ships = []
        this.busyCells = []
        this.hits = []
        this.misses = []
    }

    addShips(ships) {
        if (this.ships.length > 0) throw new Error("Ships are already added")
        if (ships.length !== 5) throw new Error("Place all ships on the board")
        const areShipsPlaced = ships.every(ship => ship.location)
        if (!areShipsPlaced) throw new Error("Place all ships on the board")
        ships.forEach(ship => this.addShip(ship))
    }

    addShip(ship) {
        // check if ship can be placed
        if (this.ships.length >= 5) throw new Error("Maximum number of ships reached")
        // check if ship had valid rotation
        if (ship.rotation !== "horizontal" && ship.rotation !== "vertical") throw new Error("Invalid rotation")
        // check ship location and cells
        if (ship.rotation === "horizontal") {
            const shipCells = Array(ship.length).fill(0).map((_, i) => locationToCell(ship.location) + i)
            if (shipCells.some(cell => cell > 99 || cell < 0)) throw new Error("Ship is out of bounds")
            if (!deepCompareArrays(shipCells, ship.cells)) throw new Error("Invalid ship cells")
            const row = Math.floor(shipCells[0] / 10)
            if (shipCells.some(cell => Math.floor(cell / 10) !== row)) throw new Error("Ship is out of bounds")
            if (shipCells.some(cell => this.busyCells.includes(cell))) throw new Error("Ship overlaps with another ship")
        } else {
            const shipCells = Array(ship.length).fill(0).map((_, i) => locationToCell(ship.location) + i * GRID_COLS)
            if (shipCells.some(cell => cell > 99 || cell < 0)) throw new Error("Ship is out of bounds")
            if (!deepCompareArrays(shipCells, ship.cells)) throw new Error("Invalid ship cells")
            if (shipCells.some(cell => this.busyCells.includes(cell))) throw new Error("Ship overlaps with another ship")
        }
        // add ship
        this.ships.push(new Ship(ship))
        this.busyCells.push(...ship.cells)
    }

    clearShips() {
        this.ships = []
        this.busyCells = []
    }

    attack(cell) {
        if (this.hits.includes(cell) || this.misses.includes(cell)) throw new Error("Cell is already attacked")
        if (!this.busyCells.includes(cell)) {
            this.misses.push(cell)
            return { result: "miss" }
        }

        this.hits.push(cell)
        this.busyCells = this.busyCells.filter(busyCell => busyCell !== cell)
        const affectedShip = this.ships.find(ship => ship.cells.includes(cell))
        const result = affectedShip.attack(cell)
        if (!result) {
            return { result: "hit" }
        }
        return { result: "destroyed" }
    }

    get allDestroyed() {
        return this.ships.every(ship => ship.destroyed)
    }
}

class Ship {
    constructor(newShip) {
        if (
            !newShip ||
            ![0, 1, 2, 3, 4].includes(newShip.index) ||
            !newShip.location ||
            !newShip.rotation ||
            !newShip.size ||
            !newShip.cells ||
            newShip.cells.length !== newShip.size
        ) throw new Error("Invalid ship")
        this.index = newShip.index
        this.location = newShip.location
        this.rotation = newShip.rotation
        this.size = newShip.size
        this.cells = newShip.cells
        this.damages = []
        this.destroyed = false
    }

    attack(cell) {
        this.damages.push(cell)
        if (this.damages.length === this.size) {
            this.destroyed = true
            return { destroyed: this.size }
        }
    }
}

module.exports = Controller;