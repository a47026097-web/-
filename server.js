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
let groups = ["الدردشة العامة"];

io.on('connection', (socket) => {
    socket.emit('load_history', messages);

    socket.on('verify_user', (username) => {
        if (!username || username.trim() === "") return;
        verifiedUsers[username] = { socketId: socket.id, status: 'متصل الآن', lastSeen: 'الآن' };
        socket.username = username;
        socket.emit('auth_success', username);
        updateUsersList();
        io.emit('update_groups', groups);
    });

    function updateUsersList() {
        const usersData = {};
        for (let u in verifiedUsers) {
            usersData[u] = { status: verifiedUsers[u].status, lastSeen: verifiedUsers[u].lastSeen };
        }
        io.emit('update_users', usersData);
    }

    socket.on('create_group', (groupName) => {
        if (groupName && !groups.includes(groupName)) {
            groups.push(groupName);
            io.emit('update_groups', groups);
        }
    });

    socket.on('send_message', (data) => {
        messages.push(data);
        if (messages.length > 300) messages.shift();
        io.emit('receive_message', data);
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('display_typing', data);
    });

    socket.on('call_user', (data) => {
        const target = verifiedUsers[data.to];
        if (target) {
            io.to(target.socketId).emit('incoming_call', { from: data.from, offer: data.offer, type: data.type });
        }
    });

    socket.on('make_answer', (data) => {
        const target = verifiedUsers[data.to];
        if (target) {
            io.to(target.socketId).emit('call_answered', { answer: data.answer, from: data.from });
        }
    });

    socket.on('ice_candidate', (data) => {
        const target = verifiedUsers[data.to];
        if (target) {
            io.to(target.socketId).emit('ice_candidate', { candidate: data.candidate });
        }
    });

    socket.on('disconnect', () => {
        if (socket.username && verifiedUsers[socket.username]) {
            verifiedUsers[socket.username].status = 'آخر ظهور: ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            updateUsersList();
            delete verifiedUsers[socket.username];
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل بكفاءة على البورت ${PORT}`);
});
