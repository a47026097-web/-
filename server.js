const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تقديم الملفات الثابتة (مثل index.html) من نفس المجلد
app.use(express.static(__dirname));

let users = {};          // تخزين المستخدمين المتصلين وأسمائهم
let groupsList = ['الدردشة العامة']; // قائمة المجموعات
let allMessages = [];    // تخزين سجل الرسائل مؤقتاً في الذاكرة

io.on('connection', (socket) => {
    let currentUsername = null;

    // التحقق من اسم المستخدم وتسجيل دخوله
    socket.on('verify_user', (username) => {
        currentUsername = username;
        users[username] = { socketId: socket.id, status: 'متصل الآن' };
        
        socket.emit('auth_success', username);
        socket.emit('load_history', allMessages);
        io.emit('update_users', users);
        io.emit('update_groups', groupsList);
    });

    // إنشاء مجموعة جديدة
    socket.on('create_group', (groupName) => {
        if (groupName && !groupsList.includes(groupName)) {
            groupsList.push(groupName);
            io.emit('update_groups', groupsList);
        }
    });

    // إرسال واستقبال الرسائل والملفات
    socket.on('send_message', (msgData) => {
        allMessages.push(msgData);
        io.emit('receive_message', msgData);
    });

    // مؤشر الكتابة
    socket.on('typing', (data) => {
        socket.broadcast.emit('display_typing', data);
    });

    // نظام الاتصال المرئي والصوتي (WebRTC Signaling)
    socket.on('call_user', (data) => {
        const targetUser = users[data.to];
        if (targetUser) {
            io.to(targetUser.socketId).emit('incoming_call', {
                from: data.from,
                offer: data.offer,
                type: data.type
            });
        }
    });

    socket.on('make_answer', (data) => {
        const targetUser = users[data.to];
        if (targetUser) {
            io.to(targetUser.socketId).emit('call_answered', {
                answer: data.answer,
                from: data.from
            });
        }
    });

    socket.on('ice_candidate', (data) => {
        const targetUser = users[data.to];
        if (targetUser) {
            io.to(targetUser.socketId).emit('ice_candidate', {
                candidate: data.candidate
            });
        }
    });

    // التعامل مع قطع الاتصال وإزالة المستخدم من القائمة فوراً
    socket.on('disconnect', () => {
        if (currentUsername && users[currentUsername]) {
            delete users[currentUsername];
            io.emit('update_users', users);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
