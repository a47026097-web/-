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

function joinRoom(inputRoom, inputName) {
    roomID = inputRoom;
    username = inputName;

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
            localStream = stream;
            socket.emit('join-room', roomID, username);
        })
        .catch(err => console.error('Error accessing media devices.', err));
}

function leaveRoom() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    for (let id in peers) {
        if (peers[id]) {
            peers[id].close();
        }
        delete peers[id];
    }
    socket.emit('leave-room', { roomID, username });
    roomID = '';
    
    const chatBox = document.getElementById('chat-box');
    if (chatBox) chatBox.innerHTML = '';
    console.log("تمت مغادرة الغرفة بنجاح");
}

function toggleMuteMic() {
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        if (audioTracks && audioTracks.length > 0) {
            isMuted = !isMuted;
            audioTracks[0].enabled = !isMuted;
            return isMuted;
        }
    }
    return false;
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
    if (roomID && username) {
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
    if (!localStream || isMuted) return;
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

function sendAttachment(event, type) {
    if (!event.target.files || event.target.files.length === 0) return;
    const file = event.target.files[0];
    if (!file || !roomID) return;
    
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = () => {
        const payload = {
            roomID,
            username,
            type: type,
            content: reader.result,
            fileName: file.name
        };
        socket.emit('attachment-message', payload);
        appendAttachmentMessage(`أنت (${username})`, reader.result, type, file.name);
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
            div.innerHTML = `<strong>${senderName}:</strong><br><img src="${dataUrl}" class="max-w-xs rounded-lg cursor-pointer mt-1" onclick="window.open(this.src)">`;
        } else {
            div.innerHTML = `<strong>${senderName}:</strong><br><a href="${dataUrl}" download="${fileName}" class="text-blue-600 underline flex items-center gap-1 mt-1"><i class="fa-solid fa-file"></i> ${fileName}</a>`;
        }
        chatBox.appendChild(div);
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

socket.on('all-users', (users) => {
    users.forEach(user => {
        createPeerConnection(user.id, true);
    });
});

socket.on('user-joined', ({ id, username: joinedName }) => {
    createPeerConnection(id, false);
    appendMessage(`--- انضم إلى الغرفة: ${joinedName || 'مستخدم جديد'} ---`);
});

function createPeerConnection(userID, isInitiator) {
    const peerConnection = new RTCPeerConnection(configuration);
    peers[userID] = peerConnection;

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    peerConnection.ontrack = (event) => {
        let remoteAudio = document.getElementById(`audio-${userID}`);
        if (!remoteAudio) {
            remoteAudio = document.createElement('audio');
            remoteAudio.id = `audio-${userID}`;
            remoteAudio.autoplay = true;
            const audioContainer = document.getElementById('audio-container') || document.body;
            audioContainer.appendChild(remoteAudio);
        }
        if (event.streams && event.streams[0]) {
            remoteAudio.srcObject = event.streams[0];
        }
    };

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
            .catch(err => console.error('Offer production error:', err));
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
        console.error('Offer processing error:', err);
    }
});

socket.on('answer', async ({ answer, sender }) => {
    const peerConnection = peers[sender];
    if (peerConnection) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
            console.error('Answer setting error:', err);
        }
    }
});

socket.on('ice-candidate', async ({ candidate, sender }) => {
    const peerConnection = peers[sender];
    if (peerConnection && peerConnection.remoteDescription) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error('ICE adding error:', err);
        }
    }
});

socket.on('user-disconnected', ({ id, username: disconnectedName }) => {
    if (peers[id]) {
        peers[id].close();
        delete peers[id];
        const audioEl = document.getElementById(`audio-${id}`);
        if (audioEl) audioEl.remove();
        appendMessage(`--- غادر ${disconnectedName || 'مستخدم'} المكالمة ---`);
    }
});
