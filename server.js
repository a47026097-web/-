

<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>منصة المحادثة الجماعية والمكالمات الصوتية</title>
    <script src="https://tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cloudflare.com">
    <style>
        .message {
            margin-bottom: 12px;
            padding: 10px 14px;
            border-radius: 12px;
            background-color: #f3f4f6;
            max-width: 80%;
            width: fit-content;
            word-break: break-all;
        }
        .hidden { display: none; }
    </style>
</head>
<body class="bg-gray-100 font-sans h-screen flex flex-col justify-center items-center">

    <!-- واجهة تسجيل الدخول وانشاء الغرفة -->
    <div id="login-container" class="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md mx-4">
        <h2 class="text-2xl font-bold text-center text-gray-800 mb-6">الانضمام إلى غرفة المحادثة</h2>
        <div class="space-y-4">
            <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">اسم المستخدم</label>
                <input type="text" id="username-input" class="w-full px-4 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-right" placeholder="أدخل اسمك هنا...">
            </div>
            <div>
                <label class="block text-sm font-semibold text-gray-700 mb-1">معرف أو رقم الغرفة</label>
                <input type="text" id="room-input" class="w-full px-4 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-right" placeholder="مثال: room123">
            </div>
            <button onclick="initiateJoin()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl transition duration-200">دخول الغرفة</button>
        </div>
    </div>

    <!-- واجهة غرفة المحادثة الرئيسية -->
    <div id="room-container" class="hidden bg-white w-full max-w-4xl h-full md:h-[85vh] md:rounded-2xl shadow-xl flex flex-col overflow-hidden">
        <!-- شريط العنوان والتحكم علوي -->
        <div class="bg-blue-600 px-6 py-4 flex justify-between items-center text-white">
            <div>
                <h3 id="room-title" class="text-lg font-bold">غرفة: -</h3>
                <p id="user-title" class="text-xs opacity-80">المستخدم: -</p>
            </div>
            <div class="flex items-center gap-3">
                <button id="mute-btn" onclick="handleMuteToggle()" class="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-400 flex items-center justify-center transition">
                    <i class="fa-solid fa-microphone"></i>
                </button>
                <button onclick="handleLeave()" class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded-xl text-sm font-bold transition">
                    مغادرة الغرفة
                </button>
            </div>
        </div>

        <!-- حاوية عناصر الصوت الخفية للأطراف الأخرى -->
        <div id="audio-container" class="hidden"></div>

        <!-- صندوق عرض الرسائل والمرفقات -->
        <div id="chat-box" class="flex-1 p-6 overflow-y-auto bg-gray-50 flex flex-col gap-2"></div>

        <!-- مؤشر الكتابة -->
        <div id="typing-indicator" class="px-6 py-1 text-sm text-gray-500 italic hidden bg-gray-50"></div>

        <!-- شريط الإدخال والإرسال السفلي -->
        <div class="border-t p-4 bg-white flex items-center gap-3">
            <input type="text" id="message-input" oninput="notifyTyping()" onkeypress="if(event.key === 'Enter') handleTextSend()" class="flex-1 px-4 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-right" placeholder="اكتب رسالتك هنا...">
            
            <button onclick="handleTextSend()" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold transition">
                إرسال
            </button>

            <!-- زر الرسالة الصوتية المباشر -->
            <button id="voice-btn" onmousedown="startRecordingVoice(); updateVoiceBtn(true);" onmouseup="stopRecordingVoice(); updateVoiceBtn(false);" onmouseleave="stopRecordingVoice(); updateVoiceBtn(false);" class="w-11 h-11 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl flex items-center justify-center transition" title="اضغط مطولاً للتسجيل">
                <i class="fa-solid fa-microphone-lines"></i>
            </button>

            <!-- أزرار رفع المرفقات والملفات والصور -->
            <label class="w-11 h-11 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl flex items-center justify-center cursor-pointer transition" title="إرسال صورة">
                <i class="fa-solid fa-image"></i>
                <input type="file" accept="image/*" onchange="sendAttachment(event, 'image')" class="hidden">
            </label>

            <label class="w-11 h-11 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl flex items-center justify-center cursor-pointer transition" title="إرسال ملف">
                <i class="fa-solid fa-paperclip"></i>
                <input type="file" onchange="sendAttachment(event, 'file')" class="hidden">
            </label>
        </div>
    </div>

    <!-- استدعاء مكتبة السوكيت وكود العميل المحدث للتشغيل المباشر -->
    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        let roomID = '';
        let username = '';
        let localStream;
        let isMuted = false;
        let typingTimeout;
        const peers = {};

        const configuration = {
            iceServers: [
                { urls: 'stun:://google.com' },
                { urls: 'stun:://google.com' }
            ]
        };

        function initiateJoin() {
            const rInput = document.getElementById('room-input').value.trim();
            const uInput = document.getElementById('username-input').value.trim();
            if(!rInput || !uInput) return alert('الرجاء تعبئة الاسم ورقم الغرفة أولاً');

            document.getElementById('login-container').classList.add('hidden');
            document.getElementById('room-container').classList.remove('hidden');
            document.getElementById('room-title').innerText = `غرفة: ${rInput}`;
            document.getElementById('user-title').innerText = `المستخدم: ${uInput}`;

            joinRoom(rInput, uInput);
        }

        function joinRoom(inputRoom, inputName) {
            roomID = inputRoom;
            username = inputName;

            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => {
                    localStream = stream;
                    socket.emit('join-room', roomID, username);
                })
                .catch(err => {
                    console.error('Error accessing media devices.', err);
                    alert('فشل الوصول للميكروفون، تحقق من الصلاحيات.');
                });
        }

        function handleLeave() {
            leaveRoom();
            document.getElementById('room-container').classList.add('hidden');
            document.getElementById('login-container').classList.remove('hidden');
            document.getElementById('room-input').value = '';
            document.getElementById('username-input').value = '';
        }

        function leaveRoom() {
            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }
            for (let id in peers) {
                if (peers[id]) peers[id].close();
                delete peers[id];
            }
            socket.emit('leave-room', { roomID, username });
            roomID = '';
            const chatBox = document.getElementById('chat-box');
            if (chatBox) chatBox.innerHTML = '';
        }

        function handleMuteToggle() {
            const muted = toggleMuteMic();
            const btn = document.getElementById('mute-btn');
            if(muted) {
                btn.className = "w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition";
                btn.innerHTML = `<i class="fa-solid fa-microphone-slash"></i>`;
            } else {
                btn.className = "w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-400 flex items-center justify-center transition";
                btn.innerHTML = `<i class="fa-solid fa-microphone"></i>`;
            }
        }

        function toggleMuteMic() {
            if (localStream) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (audioTrack) {
                    isMuted = !isMuted;
                    audioTrack.enabled = !isMuted;
                    return isMuted;
                }
            }
            return false;
        }

        function handleTextSend() {
            const input = document.getElementById('message-input');
            const txt = input.value.trim();
            if(!txt) return;
            sendTextMessage(txt);
            input.value = '';
        }

        function sendTextMessage(messageText) {
            if (messageText && roomID) {
                socket.emit('chat-message', { roomID, message: messageText, username });
                appendMessage(`أنت (${username}): ${messageText}`);
            }
        }

        socket.on('chat-message', ({ message, username: senderName }) => {
            appendMessage(`${senderName}: ${message}`);
        });

        function notifyTyping() {
            if(roomID && username) {
                socket.emit('typing', { roomID, username });
            }
        }

        socket.on('typing', ({ username: senderName }) => {
            if (senderName !== username) {
                const indicator = document.getElementById('typing-indicator');
                if (indicator) {
                    indicator.innerText = `${senderName} يكتب الآن...`;

indicator.classList.remove('hidden');
clearTimeout(typingTimeout);
typingTimeout = setTimeout(() => {
indicator.classList.add('hidden');
}, 2000);
}
}
});
function appendMessage(text) {
const chatBox = document.getElementById('chat-box');
if (chatBox) {
const div = document.createElement('div');
div.className = 'message';
div.innerText = text;
chatBox.appendChild(div);
chatBox.scrollTop = chatBox.scrollHeight;
}
}
let mediaRecorder;
let audioChunks = [];
function startRecordingVoice() {
if (!localStream) return;
if (isMuted) {
alert("الميكروفون مكتوم حالياً، قم بإلغاء الكتم أولاً للتسجيل!");
return;
}
audioChunks = [];
mediaRecorder = new MediaRecorder(localStream);
mediaRecorder.ondataavailable = event => audioChunks.push(event.data);
mediaRecorder.onstop = () => {
const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
const reader = new FileReader();
reader.readAsDataURL(audioBlob);
reader.onloadend = () => {
const base64Audio = reader.result;
socket.emit('voice-note', { roomID, audioData: base64Audio, username });
appendVoiceMessage(أنت (${username}), base64Audio);
};
};
mediaRecorder.start();
}
function stopRecordingVoice() {
if (mediaRecorder && mediaRecorder.state !== 'inactive') {
mediaRecorder.stop();
}
}
function updateVoiceBtn(recording) {
const btn = document.getElementById('voice-btn');
if(recording && !isMuted) {
btn.className = "w-11 h-11 bg-red-500 hover:bg-red-600 text-white rounded-xl flex items-center justify-center transition";
} else {
btn.className = "w-11 h-11 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl flex items-center justify-center transition";
}
}
socket.on('voice-note', ({ audioData, username: senderName }) => {
appendVoiceMessage(senderName, audioData);
});
function appendVoiceMessage(senderName, dataUrl) {
const chatBox = document.getElementById('chat-box');
if (chatBox) {
const div = document.createElement('div');
div.className = 'message';
div.innerHTML = <strong>${senderName} (رسالة صوتية):</strong><br>;
const audio = document.createElement('audio');
audio.controls = true;
audio.src = dataUrl;
div.appendChild(audio);
chatBox.appendChild(div);
chatBox.scrollTop = chatBox.scrollHeight;
}
}
function sendAttachment(event, type) {
const file = event.target.files[0];
if (!file || !roomID) return;
if (file.size > 10 * 1024 * 1024) {
alert("الملف كبير جداً! الحد الأقصى هو 10 ميجابايت.");
return;
}
const reader = new FileReader();
reader.readAsDataURL(file);
reader.onloadend = () => {
const payload = { roomID, username, type: type, content: reader.result, fileName: file.name };
socket.emit('attachment-message', payload);
appendAttachmentMessage(أنت (${username}), reader.result, type, file.name);
};
}
socket.on('attachment-message', ({ content, username: senderName, type, fileName }) => {
appendAttachmentMessage(senderName, content, type, fileName);
});
function appendAttachmentMessage(senderName, dataUrl, type, fileName) {
const chatBox = document.getElementById('chat-box');
if (chatBox) {
const div = document.createElement('div');
div.className = 'message';
if (type === 'image') {
div.innerHTML = <strong>${senderName}:</strong><br><img src="${dataUrl}" class="max-w-xs rounded-lg cursor-pointer mt-1" onclick="window.open(this.src)">;
} else {
div.innerHTML = <strong>${senderName}:</strong><br><a href="${dataUrl}" download="${fileName}" class="text-blue-600 underline flex items-center gap-1 mt-1"><i class="fa-solid fa-file"></i> ${fileName}</a>;
}
chatBox.appendChild(div);
chatBox.scrollTop = chatBox.scrollHeight;
}
}
socket.on('all-users', (users) => {
users.forEach(user => createPeerConnection(user.id, true));
});
socket.on('user-joined', ({ id, username: joinedName }) => {
createPeerConnection(id, false);
appendMessage(--- انضم إلى الغرفة: ${joinedName || 'مستخدم جديد'} ---);
});
function createPeerConnection(userID, isInitiator) {
const peerConnection = new RTCPeerConnection(configuration);
peers[userID] = peerConnection;
if (localStream) {
localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
}
peerConnection.ontrack = (event) => {
let remoteAudio = document.getElementById(audio-${userID});
if (!remoteAudio) {
remoteAudio = document.createElement('audio');
remoteAudio.id = audio-${userID};
remoteAudio.autoplay = true;
document.getElementById('audio-container').appendChild(remoteAudio);
}
remoteAudio.srcObject = event.streams[0];
};
peerConnection.onicecandidate = (event) => {
if (event.candidate) {
socket.emit('ice-candidate', { target: userID, candidate: event.candidate, sender: socket.id });
}
};
if (isInitiator) {
peerConnection.createOffer()
.then(offer => peerConnection.setLocalDescription(offer))
.then(() => {
socket.emit('offer', { target: userID, offer: peerConnection.localDescription, sender: socket.id });
})
.catch(err => console.error("Error creating offer:", err));
}
return peerConnection;
}
socket.on('offer', async ({ offer, sender }) => {
let peerConnection = peers[sender] || createPeerConnection(sender, false);
try {
await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
const answer = await peerConnection.createAnswer();
await peerConnection.setLocalDescription(answer);
socket.emit('answer', { target: sender, answer, sender: socket.id });
} catch (err) {
console.error("Error handling offer:", err);
}
});
socket.on('answer', async ({ answer, sender }) => {
const peerConnection = peers[sender];
if (peerConnection) {
try {
await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
} catch (err) {
console.error("Error setting remote description from answer:", err);
}
}
});
socket.on('ice-candidate', async ({ candidate, sender }) => {
const peerConnection = peers[sender];
if (peerConnection && peerConnection.remoteDescription) {
try {
await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
} catch (err) {
console.error("Error adding ICE candidate:", err);
}
}
});
socket.on('user-disconnected', ({ id, username: disconnectedName }) => {
if (peers[id]) {
peers[id].close();
delete peers[id];
const audioEl = document.getElementById(audio-${id});
if (audioEl) audioEl.remove();
appendMessage(--- غادر ${disconnectedName || 'مستخدم'} المكالمة ---);
}
});
