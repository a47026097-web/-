const socket = io();
const roomID = "room-123"; // رقم أو اسم الغرفة
const peers = {}; // تخزين الاتصالات لكل يوزر
let localStream;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// تشغيل الميكروفون الخاص بالمستخدم
navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(stream => {
        localStream = stream;
        socket.emit('join-room', roomID);
    }).catch(err => console.error('Error accessing media devices.', err));

// استقبال قائمة المستخدمين الموجودين بالغرفة عند الانضمام
socket.on('all-users', (users) => {
    users.forEach(userID => {
        createPeerConnection(userID, true); // ابدأ الاتصال كـ Initiator
    });
});

// مستخدم جديد انضم للغرفة
socket.on('user-joined', (userID) => {
    createPeerConnection(userID, false);
});

// إنشاء اتصال WebRTC جديد مع مستخدم آخر
function createPeerConnection(userID, isInitiator) {
    const peerConnection = new RTCPeerConnection(configuration);
    peers[userID] = peerConnection;

    // إضافة الصوت الخاص بك للاتصال
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    // استقبال الصوت القادم من الطرف الآخر
    peerConnection.ontrack = (event) => {
        const remoteAudio = document.createElement('audio');
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.autoplay = true;
        remoteAudio.id = `audio-${userID}`;
        document.body.appendChild(remoteAudio);
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
            });
    }
}

// استقبال الـ Offer
socket.on('offer', async ({ offer, sender }) => {
    let peerConnection = peers[sender];
    if (!peerConnection) {
        peerConnection = createPeerConnectionForReceiver(sender);
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { target: sender, answer, sender: socket.id });
});

// استقبال الـ Answer
socket.on('answer', async ({ answer, sender }) => {
    const peerConnection = peers[sender];
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

// استقبال الـ ICE Candidate
socket.on('ice-candidate', async ({ candidate, sender }) => {
    const peerConnection = peers[sender];
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
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

function createPeerConnectionForReceiver(userID) {
    const peerConnection = new RTCPeerConnection(configuration);
    peers[userID] = peerConnection;

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        const remoteAudio = document.createElement('audio');
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.autoplay = true;
        remoteAudio.id = `audio-${userID}`;
        document.body.appendChild(remoteAudio);
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

    return peerConnection;
}
