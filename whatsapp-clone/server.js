
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تقديم الملفات الثابتة من مجلد المشروع
app.use(express.static(path.join(__dirname)));

// مصفوفة لحفظ الرسائل مؤقتاً في الذاكرة لكي لا تضيع عند مغادرة الدردشة
let messages = [];

io.on('connection', (socket) => {
    console.log('مستخدم متصل جديد...');

    // عند اتصال المستخدم، أرسل له سجل الرسائل القديمة فوراً
    socket.emit('load_history', messages);

    // استقبال رسالة جديدة من أي مستخدم
    socket.on('send_message', (data) => {
        // حفظ الرسالة في المصفوفة
        messages.push(data);
        
        // إذا زادت الرسائل عن 100 رسالة، احذف القديمة لكي يبقى السيرفر خفيفاً
        if (messages.length > 100) {
            messages.shift();
        }

        // إرسال الرسالة لجميع المتصلين (بمن فيهم المرسل)
        io.emit('receive_message', data);
    });

    socket.on('disconnect', () => {
        console.log('مستخدم غادر الدردشة.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`السيرفر يعمل على البورت ${PORT}`);
});