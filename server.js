const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let groups = {};

io.on('connection', (socket) => {
  socket.on('join_group', (groupName) => {
    socket.join(groupName);
    if (!groups[groupName]) groups[groupName] = [];
    socket.emit('load_messages', groups[groupName]);
  });

  socket.on('send_message', (data) => {
    if (groups[data.groupName]) groups[data.groupName].push(data);
    io.to(data.groupName).emit('receive_message', data);
  });

  // تعديل إرسال المكالمة ليشمل الجميع في الجروب بوضوح
  socket.on('start_call', (data) => {
    socket.to(data.groupName).emit('incoming_call', { peerId: data.peerId, sender: data.sender });
  });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`السيرفر يعمل على البورت ${PORT}`);
});