const socket = io();
let roomID = '';
let username = '';
let localStream;
const peers = {}; // تخزين الاتصالات لكل يوزر

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- 1. بدء الدخول للغرفة وتفعيل الميكروفون ---
function joinRoom(inputRoom, inputName) {
    roomID = inputRoom;
    username = inputName;

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
            localStream = stream;
            // إرسال طلب الانضمام للسيرفر مع الاسم ورقم الغرفة
            socket.emit('join-room', roomID, username);
        })
        .catch(err => console.error('Error accessing media devices.', err));
}


// --- 2. نظام الرسائل النصية الجماعية ---
function sendTextMessage(messageText) {
    if (messageText && roomID) {
        socket.emit('chat-message', { roomID, message: messageText, username });
        appendMessage(`أنت (${username}): ${messageText}`);
    }
}

socket.on('chat-message', ({ message, username: senderName }) => {
    appendMessage(`${senderName}: ${message}`);
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


// --- 3. نظام الرسائل الصوتية (Voice Notes) ---
let mediaRecorder;
let audioChunks = [];

function startRecordingVoice() {
    if (!localStream) return;
    audioChunks = [];
    mediaRecorder = new MediaRecorder(localStream);

    mediaRecorder.ondataavailable = event => {
        audioChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
            const base64Audio = reader.result;
            socket.emit('voice-note', { roomID, audioData: base64Audio, username });
            appendVoiceMessage(`أنت (${username})`, base64Audio);
        };
    };

    mediaRecorder.start();
}

function stopRecordingVoice() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
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
        div.innerHTML = `<strong>${senderName} (رسالة صوتية):</strong><br>`;
        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = dataUrl;
        div.appendChild(audio);
        chatBox.appendChild(div);
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}


// --- 4. مكالمات WebRTC الصوتية الجماعية (Mesh Topology) ---

// استقبال قائمة المستخدمين الموجودين بالغرفة عند الانضمام
socket.on('all-users', (users) => {
    users.forEach(user => {
        createPeerConnection(user.id, true); // ابدأ الاتصال كـ Initiator
    });
});

// مستخدم جديد انضم للغرفة
socket.on('user-joined', ({ id }) => {
    createPeerConnection(id, false);
});

// إنشاء اتصال WebRTC جديد مع مستخدم آخر
function createPeerConnection(userID, isInitiator) {
    const peerConnection = new RTCPeerConnection(configuration);
    peers[userID] = peerConnection;
    
    // طابور مؤقت لحفظ الـ ICE Candidates لحين إعداد الـ RemoteDescription
    peerConnection.pendingCandidates = [];

    // إضافة الصوت الخاص بك للاتصال
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // استقبال الصوت القادم من الطرف الآخر
    peerConnection.ontrack = (event) => {
        let remoteAudio = document.getElementById(`audio-${userID}`);
        if (!remoteAudio) {
            remoteAudio = document.createElement('audio');
            remoteAudio.id = `audio-${userID}`;
            remoteAudio.autoplay = true;
            const audioContainer = document.getElementById('audio-container') || document.body;
            audioContainer.appendChild(remoteAudio);
        }
        remoteAudio.srcObject = event.streams[0];
    };

    // جمع الـ ICE Candidates وإرسالها للطرف الآخر
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', {
                target: userID,
                candidate: event.candidate,
                sender: socket.id
            });
        }
    };

    if (isInitiator) {
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                socket.emit('offer', {
                    target: userID,
                    offer: peerConnection.localDescription,
                    sender: socket.id
                });
            })
            .catch(err => console.error('Error creating offer:', err));
    }

    return peerConnection;
}

// استقبال الـ Offer
socket.on('offer', async ({ offer, sender }) => {
    let peerConnection = peers[sender] || createPeerConnection(sender, false);
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        
        // تفريغ الطابور المؤقت للـ ICE Candidates بعد تعيين الـ RemoteDescription
        while (peerConnection.pendingCandidates && peerConnection.pendingCandidates.length > 0) {
            const candidate = peerConnection.pendingCandidates.shift();
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { target: sender, answer, sender: socket.id });
    } catch (err) {
        console.error('Error handling offer:', err);
    }
});

// استقبال الـ Answer
socket.on('answer', async ({ answer, sender }) => {
    const peerConnection = peers[sender];
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            
            // تفريغ الطابور المؤقت هنا أيضاً
            while (peerConnection.pendingCandidates && peerConnection.pendingCandidates.length > 0) {
                const candidate = peerConnection.pendingCandidates.shift();
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (err) {
            console.error('Error handling answer:', err);
        }
    }
});

// استقبال الـ ICE Candidate مع معالجة الطابور
socket.on('ice-candidate', async ({ candidate, sender }) => {
    const peerConnection = peers[sender];
    if (peerConnection) {
        try {
            if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                // إذا لم يتم إعداد RemoteDescription بعد، نخزنه مؤقتاً
                peerConnection.pendingCandidates.push(candidate);
            }
        } catch (err) {
            console.error('Error adding received ice candidate', err);
        }
    }
});

// مغادرة مستخدم للاتصال
socket.on('user-disconnected', (userID) => {
    if (peers[userID]) {
        peers[userID].close();
        delete peers[userID];
        const audioEl = document.getElementById(`audio-${userID}`);
        if (audioEl) audioEl.remove();
    }
});
