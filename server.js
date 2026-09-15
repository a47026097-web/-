const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // تفعيل الاتصال من أي مكان بالعالم مجاناً
});

app.use(express.static(path.join(__dirname)));

let messages = []; // سجل حفظ الرسائل مؤقتاً في الذاكرة

io.on('connection', (socket) => {
    console.log('مستخدم متصل جديد...');

    // 1. نظام المراسلة النصية الجاهز مالتك
    socket.emit('load_history', messages);

    socket.on('send_message', (data) => {
        messages.push(data);
        if (messages.length > 100) messages.shift(); // الحفاظ على خفة السيرفر
        io.emit('receive_message', data);
    });

    // 2. نظام المخابرة الصوتية اللامركزية المضاف (WebRTC)
    socket.on('join_voice_room', (roomId) => {
        socket.join(roomId);
        socket.to(roomId).emit('user_joined_voice', socket.id);
    });

    socket.on('call_user', (data) => {
        io.to(data.to).emit('incoming_call', { from: socket.id, offer: data.offer });
    });

    socket.on('answer_call', (data) => {
        io.to(data.to).emit('call_accepted', { from: socket.id, ans: data.ans });
    });

    socket.on('ice_candidate', (data) => {
        io.to(data.to).emit('ice_candidate', { from: socket.id, candidate: data.candidate });
    });

    socket.on('disconnect', () => {
        console.log('مستخدم غادر الدردشة.');
    });
});

// التعديل مالتك هنا: تشغيل السيرفر على البورت 8080 مباشرة
const PORT = 8080; 
server.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`✅ تطبيق المراسلة والمخابرة يعمل بنجاح!`);
    console.log(`📡 السيرفر شغال الآن على البورت: ${PORT}`);
    console.log(`========================================`);
});
