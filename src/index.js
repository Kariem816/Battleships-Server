const express = require('express');
const path = require('path');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
require('dotenv').config();
const SessionController = require('./controllers/session.controller');


const port = 3000;

const sessionController = new SessionController

app.use(express.static('public'))
app.use((_req, res, next) => {
    res.set('Cache-control', 'public, max-age=300')
    next()
});

app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, "../public", '/index.html'));
});

app.get('/game/:gameId', (_req, res) => {
    res.sendFile(path.join(__dirname, "../public", '/index.html'));
});

app.get('/host', (_req, res) => {
    res.sendFile(path.join(__dirname, "../public", '/index.html'));
});

app.get('/join', (_req, res) => {
    res.sendFile(path.join(__dirname, "../public", '/index.html'));
});

app.get("*", (_req, res) => {
    res.status(404).send("Not found");
})

io.on('connection', (socket) => {
    sessionController.addUser(socket.id);

    socket.on("login", (name) => {
        try {
            if (!name.trim()) throw new Error("Name is required")
            sessionController.login(socket.id, name)
            socket.emit("logged-in", name)
            if (sessionController.getUser(socket.id).game) {
                const roomId = sessionController.getUser(socket.id).game
                socket.join(roomId)
                io.to(roomId).emit("game-state", sessionController.getGame(roomId))
                socket.to(roomId).emit("system-message", {
                    type: "success",
                    text: name + " has reconnected",
                })
            }
        } catch (err) {
            socket.emit("login-error", err.message)
        }
    })

    socket.on("logout", () => {
        try {
            const roomId = sessionController.leaveGame(socket.id)
            socket.leave(roomId)
            sessionController.logout(socket.id)
            socket.emit("logged-out")
        } catch (err) {
            socket.emit("logout-error", err.message)
        }
    })

    socket.on("host", (options) => {
        try {
            const room = sessionController.createGame(socket.id, options)
            socket.join(room)
            socket.emit("hosted", room)
        } catch (err) {
            socket.emit("host-error", err.message)
        }
    })

    socket.on("public-rooms", () => {
        try {
            const rooms = sessionController.getPublicGames()
            socket.emit("public-rooms", rooms)
        } catch (err) {
            socket.emit("public-rooms-error", err.message)
        }
    })

    socket.on("join", (roomId) => {
        try {
            sessionController.joinGame(socket.id, roomId)
            socket.join(roomId)
            socket.emit("joined", roomId)
            const user = sessionController.getUser(socket.id)
            socket.to(roomId).emit("system-message", {
                type: "success",
                text: user.username + " joined the room",
            })
            io.to(roomId).emit("game-state", sessionController.getGame(roomId))
        } catch (err) {
            socket.emit("join-error", err.message)
        }
    })

    socket.on("leave-room", () => {
        try {
            const roomId = sessionController.leaveGame(socket.id)
            socket.leave(roomId)
            const user = sessionController.getUser(socket.id)
            socket.to(roomId).emit("system-message", {
                type: "error",
                text: user.username + " left the room",
            })
            io.to(roomId).emit("game-state", sessionController.getGame(roomId))
        } catch (err) {
            socket.emit("leave-room-error", err.message)
        }
    })

    socket.on("game-state", () => {
        try {
            const user = sessionController.getUser(socket.id)
            if (!user.game) throw new Error("You are not in a game")
            socket.emit("game-state", sessionController.getGame(user.game))
        } catch (err) {
            socket.emit("game-state-error", err.message)
        }
    })

    socket.on("message", (message) => {
        try {
            if (!message.trim()) throw new Error("Message is required")
            const { isCommand, command, data } = checkCommand(message)
            if (isCommand) {
                onGameAction({ action: command, data })
                return
            }
            const user = sessionController.getUser(socket.id)
            io.to(user.game).emit("message", {
                sender: user.username,
                text: message,
            })
        } catch (err) {
            if (err.message.includes("Unexpected token")) {
                socket.emit("system-message", {
                    type: "error",
                    text: "Invalid data",
                })
                return
            }
            if (err.message === "Action not supported") {
                const user = sessionController.getUser(socket.id)
                io.to(user.game).emit("message", {
                    sender: user.username,
                    text: message,
                })
                return
            }
            socket.emit("system-message", {
                type: "error",
                text: err.message,
            })
        }
    })

    function checkCommand(message) {
        if (message[0] !== "!") return { isCommand: false }
        const messageParts = message.split(" ")
        if (messageParts.length === 1 && messageParts[0].length === 1) return { isCommand: false }
        const command = messageParts[0].slice(1)
        const dataText = messageParts.slice(1).join(" ")
        const data = dataText ? JSON.parse(dataText) : {}
        return { isCommand: true, command, data }
    }

    function onGameAction({ action, data }) {
        const response = sessionController.handleAction(action, socket.id, data)
        if (!response) return
        switch (response.how) {
            case "broadcast":
                io.to(response.room).emit("game-action", response.data)
                break;
            case "self":
                socket.emit("game-action", response.data)
                break;
            case "all":
                io.emit("game-action", response.data)
                break;
            case "different":
                const toUser = response.data[0]
                const toRoom = response.data[1]
                socket.to(response.room).emit("game-action", toRoom)
                socket.emit("game-action", toUser)
                break;
            case "room":
                socket.to(response.room).emit("game-action", response.data)
                break;
            default:
        }
        if (response.sendMessage) {
            socket.to(response.room).emit("system-message", {
                type: "info",
                text: response.sendMessage
            })
            socket.emit("system-message", {
                type: "info",
                text: response.sendMessage
            })
        }
    }

    socket.on("game-action", ({ action, data }) => {
        try {
            onGameAction({ action, data })
        } catch (err) {
            socket.emit("system-message", {
                type: "error",
                text: err.message,
            })
        }
    })

    socket.on('disconnect', () => {
        const user = sessionController.getUser(socket.id)
        if (user && user.game) {
            const gameId = user.game
            socket.to(gameId).emit("system-message", {
                type: "error",
                text: user.username + " has disconnected",
            })
            sessionController.disconnectUser(socket.id);
            new Promise((resolve) => {
                setTimeout(resolve, 1000)
            }).then(() => {
                io.to(gameId).emit("game-state", sessionController.getGame(gameId))
            })
        } else {
            sessionController.removeUser(socket.id);
        }
    });
});

server.listen(port, () => {
    console.log(`Server listening at port ${port}`);
});