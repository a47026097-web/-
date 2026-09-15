const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    maxHttpBufferSize: 20 * 1024 * 1024, 
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; 

io.on('connection', (socket) => {

    socket.on('join-room', (roomID, username) => {
        socket.join(roomID);
        
        if (!rooms[roomID]) {
            rooms[roomID] = [];
        }

        const otherUsers = rooms[roomID].map(user => ({ id: user.id, username: user.username }));
        socket.emit('all-users', otherUsers);

        rooms[roomID].push({ id: socket.id, username });

        socket.to(roomID).emit('user-joined', { id: socket.id, username });
        
        socket.roomID = roomID;
        socket.username = username;
    });

    socket.on('chat-message', (payload) => {
        socket.to(payload.roomID).emit('chat-message', payload);
    });

    socket.on('typing', ({ roomID, username }) => {
        socket.to(roomID).emit('typing', { username, roomID });
    });

    socket.on('offer', ({ target, offer, sender }) => {
        io.to(target).emit('offer', { offer, sender });
    });

    socket.on('answer', ({ target, answer, sender }) => {
        io.to(target).emit('answer', { answer, sender });
    });

    socket.on('ice-candidate', ({ target, candidate, sender }) => {
        io.to(target).emit('ice-candidate', { candidate, sender });
    });

    socket.on('leave-room', () => {
        handleDisconnect(socket);
    });

    socket.on('disconnect', () => {
        handleDisconnect(socket);
    });
});

function handleDisconnect(socket) {
    const roomID = socket.roomID;
    const username = socket.username;

    if (roomID && rooms[roomID]) {
        rooms[roomID] = rooms[roomID].filter(user => user.id !== socket.id);
        io.to(roomID).emit('user-disconnected', { id: socket.id, username });

        if (rooms[roomID].length === 0) {
            delete rooms[roomID];
        }
    }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
