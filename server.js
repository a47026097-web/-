const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));

let messages = [];
let verifiedUsers = {};

io.on('connection', (socket) => {
    socket.emit('load_history', messages);
    socket.emit('update_users', Object.keys(verifiedUsers));

    socket.on('verify_user', (username) => {
        if (!username || username.trim() === "") return;
        verifiedUsers[username] = { socketId: socket.id };
        socket.emit('auth_success', username);
        io.emit('update_users', Object.keys(verifiedUsers));
    });

    socket.on('send_message', (data) => {
        messages.push(data);
        if (messages.length > 100) messages.shift();
        io.emit('receive_message', data);
    });

    // إدارة طلب المكالمة
    socket.on('call_user', (data) => {
        // data: { from, to, type }
        io.emit('incoming_call', data);
    });

    socket.on('disconnect', () => {
        console.log('مستخدم غادر.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على البورت ${PORT}`);
});
