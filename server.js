const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تقديم الملفات الثابتة
app.use(express.static(__dirname));

io.on('connection', (socket) => {
    console.log('مستخدم متصل:', socket.id);

    // 1. الانضمام للغرفة (مع حماية ضد البيانات الفارغة)
    socket.on('join-room', (roomID, username) => {
        if (!roomID || !username) return;
        socket.join(roomID);
        socket.username = username;
        socket.roomID = roomID;

        const roomClients = io.sockets.adapter.rooms.get(roomID);
        const usersInRoom = [];
        if (roomClients) {
            roomClients.forEach((clientId) => {
                if (clientId !== socket.id) {
                    const clientSocket = io.sockets.sockets.get(clientId);
                    usersInRoom.push({
                        id: clientId,
                        username: clientSocket ? clientSocket.username : 'مستخدم'
                    });
                }
            });
        }

        socket.emit('all-users', usersInRoom);
        socket.to(roomID).emit('user-joined', {
            id: socket.id,
            username: username
        });
    });

    // مغادرة الغرفة
    socket.on('leave-room', (data) => {
        if (!data || !data.roomID) return;
        socket.leave(data.roomID);
        socket.to(data.roomID).emit('user-disconnected', socket.id);
        socket.roomID = null;
    });

    // مؤشر الكتابة
    socket.on('typing', (data) => {
        if (!data || !data.roomID) return;
        socket.to(data.roomID).emit('typing', { username: data.username });
    });

    // 2. الرسائل النصية (مع حماية إضافية)
    socket.on('chat-message', (data) => {
        if (!data) return;
        const { roomID, message, username } = data;
        if (roomID && message) {
            socket.to(roomID).emit('chat-message', { message, username });
        }
    });

    // 3. الرسائل الصوتية
    socket.on('voice-note', (data) => {
        if (!data) return;
        const { roomID, audioData, username } = data;
        if (roomID && audioData) {
            socket.to(roomID).emit('voice-note', { audioData, username });
        }
    });

    // 4. إرسال الصور والملفات (تمت اضافتها لمنع أي أخطاء مفقودة)
    socket.on('attachment-message', (data) => {
        if (!data) return;
        const { roomID, username, type, content, fileName } = data;
        if (roomID && content) {
            socket.to(roomID).emit('attachment-message', { username, type, content, fileName });
        }
    });

    // 5. إشارات WebRTC (مع حماية التأكد من وجود الـ target)
    socket.on('offer', (data) => {
        if (!data || !data.target) return;
        io.to(data.target).emit('offer', { offer: data.offer, sender: data.sender });
    });

    socket.on('answer', (data) => {
        if (!data || !data.target) return;
        io.to(data.target).emit('answer', { answer: data.answer, sender: data.sender });
    });

    socket.on('ice-candidate', (data) => {
        if (!data || !data.target) return;
        io.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: data.sender });
    });

    // 6. الخروج أو انقطاع الاتصال
    socket.on('disconnect', () => {
        if (socket.roomID) {
            socket.to(socket.roomID).emit('user-disconnected', socket.id);
        }
        console.log('انقطع اتصال المستخدم:', socket.id);
    });
});

// حماية إضافية شاملة لمنع السيرفر من الـ Crash نهائياً لو حدث أي خطأ غير متوقع
process.on('uncaughtException', (err) => {
    console.error('خطأ غير متوقع (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('رفض وعد غير معالج (Unhandled Rejection):', reason);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
