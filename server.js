const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" } // تفعيل الاتصال من أي مكان بالعالم
});

app.use(express.static(path.join(__dirname)));

let messages = []; // سجل حفظ الرسائل مؤقتاً

io.on('connection', (socket) => {
    console.log('مستخدم متصل جديد...'); //

    // 1. نظام المراسلة النصية الجاهز مالتك
    socket.emit('load_history', messages); //

    socket.on('send_message', (data) => {
        messages.push(data); //
        if (messages.length > 100) messages.shift(); //
        io.emit('receive_message', data); //
    });

    // 2. نظام المخابرة الصوتية اللامركزية المضاف (WebRTC Signaling)
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
        console.log('مستخدم غادر الدردشة.'); //
    });
});

// تشغيل السيرفر على منفذ ثابت وآمن للويندوز
const PORT = 3000; //
server.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`✅ تطبيق المراسلة والمخابرة يعمل بنجاح!`);
    console.log(`📡 الرابط المحلي: http://localhost:${PORT}`);
    console.log(`========================================`);
});
