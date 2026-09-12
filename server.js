const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تقديم الملفات الثابتة
app.use(express.static(path.join(__dirname)));

// مصفوفة لحفظ الرسائل (بحد أقصى 100 رسالة)
let messages = [];

// قائمة المستخدمين المسجلين النشطين
let registeredUsers = [];

io.on('connection', (socket) => {
    console.log('مستخدم متصل جديد...');

    // إرسال السجل للمستخدم فور دخوله
    socket.emit('load_history', messages);
    socket.emit('update_users', registeredUsers);

    // تسجيل مستخدم جديد
    socket.on('register_user', (username) => {
        if (username && !registeredUsers.includes(username)) {
            registeredUsers.push(username);
            io.emit('update_users', registeredUsers);
        }
    });

    // استقبال رسالة نصية أو صورة
    socket.on('send_message', (data) => {
        // data = { username, text, image, chat, type }
        messages.push(data);
        if (messages.length > 100) {
            messages.shift();
        }
        // إرسال الرسالة للجميع
        io.emit('receive_message', data);
    });

    // إشارات المكالمات (اتصال WebRTC مبسط بين الأطراف)
    socket.on('call_user', (data) => {
        io.emit('incoming_call', data);
    });

    socket.on('disconnect', () => {
        console.log('مستخدم غادر الدردشة.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على البورت ${PORT}`);
});
