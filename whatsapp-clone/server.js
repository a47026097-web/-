const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, '.')));

const users = {}; // حفظ المستخدمين مع Socket ID الخاص بهم
const groups = ["الدردشة العامة"];
const messages = []; // حفظ سجل الرسائل

io.on('connection', (socket) => {
    
    // التحقق من اسم المستخدم وتسجيله
    socket.on('verify_user', (username) => {
        if (!username) return;
        users[username] = { id: socket.id, status: 'متصل' };
        socket.username = username;
        
        socket.emit('auth_success', username);
        socket.emit('load_history', messages);
        
        io.emit('update_users', users);
        io.emit('update_groups', groups);
    });

    // إنشاء مجموعة جديدة
    socket.on('create_group', (groupName) => {
        if (groupName && !groups.includes(groupName)) {
            groups.push(groupName);
            io.emit('update_groups', groups);
        }
    });

    // استقبال وإرسال الرسائل والصور والصوتيات
    socket.on('send_message', (msgData) => {
        messages.push(msgData);
        io.emit('receive_message', msgData);
    });

    // مؤشر الكتابة
    socket.on('typing', (data) => {
        socket.broadcast.emit('display_typing', data);
    });

    // ==========================================
    // إدارة إشارات مكالمات WebRTC (الصوت والفيديو)
    // ==========================================
    
    // طلب مكالمة جديد موجه لمستخدم معين
    socket.on('call_user', (data) => {
        const targetUser = users[data.to];
        if (targetUser) {
            io.to(targetUser.id).emit('incoming_call', {
                from: data.from,
                offer: data.offer,
                type: data.type
            });
        }
    });

    // قبول المكالمة وإرسال الرد (Answer)
    socket.on('make_answer', (data) => {
        const targetUser = users[data.to];
        if (targetUser) {
            io.to(targetUser.id).emit('call_answered', {
                answer: data.answer,
                from: data.from
            });
        }
    });

    // تبادل بيانات المسارات (ICE Candidates)
    socket.on('ice_candidate', (data) => {
        const targetUser = users[data.to];
        if (targetUser) {
            io.to(targetUser.id).emit('ice_candidate', {
                candidate: data.candidate,
                from: data.from
            });
        }
    });

    // إدارة تنبيه تفعيل خادم الـ TURN وتعميمه للطرفين
    socket.on('turn_connection_active', (data) => {
        const targetUser = users[data.to];
        if (targetUser) {
            io.to(targetUser.id).emit('show_turn_alert');
        }
        socket.emit('show_turn_alert');
    });

    // عند انقطاع الاتصال أو إغلاق الصفحة
    socket.on('disconnect', () => {
        if (socket.username && users[socket.username]) {
            delete users[socket.username];
            io.emit('update_users', users);
        }
    });
});

const PORT = process.env.PORT || 8080;
http.listen(PORT, () => {
    console.log('Server is running on port ' + PORT);
});
