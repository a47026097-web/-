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
        verifiedUsers[username] = socket.id;
        socket.emit('auth_success', username);
        io.emit('update_users', Object.keys(verifiedUsers));
    });

    socket.on('send_message', (data) => {
        messages.push(data);
        if (messages.length > 100) messages.shift();
        io.emit('receive_message', data);
    });

    // إرسال إشارات WebRTC للمكالمات الحقيقية
    socket.on('call_user', (data) => {
        // data: { to, offer, from, type }
        const targetSocketId = verifiedUsers[data.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_call', {
                from: data.from,
                offer: data.offer,
                type: data.type
            });
        }
    });

    socket.on('make_answer', (data) => {
        // data: { to, answer, from }
        const targetSocketId = verifiedUsers[data.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_answered', {
                answer: data.answer,
                from: data.from
            });
        }
    });

    socket.on('ice_candidate', (data) => {
        const targetSocketId = verifiedUsers[data.to];
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice_candidate', {
                candidate: data.candidate
            });
        }
    });

    socket.on('disconnect', () => {
        for (let user in verifiedUsers) {
            if (verifiedUsers[user] === socket.id) {
                delete verifiedUsers[user];
                break;
            }
        }
        io.emit('update_users', Object.keys(verifiedUsers));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على البورت ${PORT}`);
});
