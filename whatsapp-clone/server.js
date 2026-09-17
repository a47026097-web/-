const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تقديم الملفات الثابتة (مثل index.html وباقي الملفات في نفس المجلد)
app.use(express.static(__dirname));

// تخزين بيانات المستخدمين والمجموعات والرسائل في الذاكرة
const users = {};       // socket.id -> username
const usersData = {};   // username -> { status: 'متصل' }
const groupsList = ["الدردشة العامة"]; // المجموعة الافتراضية
const allMessages = []; // حفظ سجل الرسائل

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    // التحقق من تسجيل المستخدم وتسجيله بالنظام
    socket.on('verify_user', (username) => {
        users[socket.id] = username;
        usersData[username] = { status: 'متصل' };
        
        socket.emit('auth_success', username);
        io.emit('update_users', usersData);
        socket.emit('update_groups', groupsList);
        socket.emit('load_history', allMessages);
    });

    // إنشاء مجموعة جديدة
    socket.on('create_group', (groupName) => {
        if (groupName && !groupsList.includes(groupName)) {
            groupsList.push(groupName);
            io.emit('update_groups', groupsList);
        }
    });

    // استقبال وإرسال الرسائل (نصوص، صور، ملفات، صوتيات)
    socket.on('send_message', (msgData) => {
        allMessages.push(msgData);
        io.emit('receive_message', msgData);
    });

    // مؤشر الكتابة (يكتب الآن...)
    socket.on('typing', (data) => {
        socket.broadcast.emit('display_typing', data);
    });

    // --- أحداث مكالمات WebRTC (الإشارات) ---
    
    // بدء مكالمة (فردية أو جماعية)
    socket.on('call_user', (data) => {
        const targetSocketId = Object.keys(users).find(id => users[id] === data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_call', {
                from: data.from,
                offer: data.offer,
                type: data.type
            });
        }
    });

    // الرد على المكالمة (Answer)
    socket.on('make_answer', (data) => {
        const targetSocketId = Object.keys(users).find(id => users[id] === data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_answered', {
                answer: data.answer,
                from: data.from
            });
        }
    });

    // تبادل الـ ICE Candidates
    socket.on('ice_candidate', (data) => {
        const targetSocketId = Object.keys(users).find(id => users[id] === data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('ice_candidate', {
                candidate: data.candidate,
                from: users[socket.id]
            });
        }
    });

    // تفعيل خادم TURN
    socket.on('turn_connection_active', (data) => {
        const targetSocketId = Object.keys(users).find(id => users[id] === data.to);
        if (targetSocketId) {
            io.to(targetSocketId).emit('show_turn_alert');
        }
    });

    // عند قطع اتصال المستخدم
    socket.on('disconnect', () => {
        const username = users[socket.id];
        if (username) {
            delete users[socket.id];
            delete usersData[username];
            io.emit('update_users', usersData);
        }
        console.log('مستخدم انقطع اتصاله:', socket.id);
    });
});

// تشغيل السيرفر على البورت المطلوب من المنصة أو 3000 محلياً
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
