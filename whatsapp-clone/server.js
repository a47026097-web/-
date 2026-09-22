
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 50 * 1024 * 1024
});

const PORT = process.env.PORT || 8080;

const DATA_FILE = path.join(__dirname, "data.json");

const MAX_CALL_PARTICIPANTS = 4;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use(express.static(__dirname));


/* =========================================================
   DATA
========================================================= */

let database = {
    users: {},
    messages: [],
    groups: [
        {
            id: "general",
            name: "الدردشة العامة",
            owner: "system",
            members: []
        }
    ]
};


function loadDatabase() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const content = fs.readFileSync(DATA_FILE, "utf8");

            if (content.trim()) {
                const saved = JSON.parse(content);

                database = {
                    users: saved.users || {},
                    messages: saved.messages || [],
                    groups: saved.groups || [
                        {
                            id: "general",
                            name: "الدردشة العامة",
                            owner: "system",
                            members: []
                        }
                    ]
                };
            }
        }
    } catch (error) {
        console.error("خطأ بقراءة data.json:", error);
    }
}


let saveTimer = null;

function saveDatabase() {
    if (saveTimer) return;

    saveTimer = setTimeout(() => {
        saveTimer = null;

        try {
            const tempFile = DATA_FILE + ".tmp";

            fs.writeFileSync(
                tempFile,
                JSON.stringify(database, null, 2),
                "utf8"
            );

            fs.renameSync(tempFile, DATA_FILE);

        } catch (error) {
            console.error("خطأ بحفظ البيانات:", error);
        }
    }, 300);
}


loadDatabase();


/* =========================================================
   ONLINE USERS
========================================================= */

const onlineUsers = {};


/*
    onlineUsers = {
        username: {
            socketId: "...",
            lastSeen: ...
        }
    }
*/


function getPublicUsers() {
    const result = {};

    for (const username in database.users) {
        const user = database.users[username];

        result[username] = {
            status: onlineUsers[username]
                ? "متصل"
                : "غير متصل",

            lastSeen: user.lastSeen || null,

            createdAt: user.createdAt || null
        };
    }

    return result;
}


function getGroups() {
    return database.groups.map(group => ({
        id: group.id,
        name: group.name,
        owner: group.owner,
        members: group.members || []
    }));
}


function findSocketByUsername(username) {
    const user = onlineUsers[username];

    if (!user) return null;

    return user.socketId;
}


function sendToUser(username, event, data) {
    const socketId = findSocketByUsername(username);

    if (!socketId) return false;

    io.to(socketId).emit(event, data);

    return true;
}


/* =========================================================
   HELPERS
========================================================= */

function cleanUsername(name) {
    if (typeof name !== "string") return "";

    return name
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 30);
}


function generateId(prefix = "id") {
    return (
        prefix +
        "_" +
        Date.now() +
        "_" +
        Math.random()
            .toString(36)
            .slice(2, 10)
    );
}


function isGroup(chatId) {
    return database.groups.some(group =>
        group.id === chatId
    );
}


function findGroup(groupId) {
    return database.groups.find(group =>
        group.id === groupId
    );
}


function isUser(username) {
    return !!database.users[username];
}


function messageBelongsToUser(message, username) {
    return (
        message.username === username ||
        message.from === username ||
        message.to === username
    );
}


/* =========================================================
   API
========================================================= */

app.get("/api/status", (req, res) => {
    res.json({
        ok: true,
        developer: "محمد حسنين",
        users: Object.keys(database.users).length,
        online: Object.keys(onlineUsers).length,
        groups: database.groups.length,
        maxCallParticipants: MAX_CALL_PARTICIPANTS
    });
});


app.get("/api/account/:username", (req, res) => {

    const username =
        cleanUsername(req.params.username);

    if (!username || !database.users[username]) {
        return res.status(404).json({
            ok: false,
            error: "الحساب غير موجود"
        });
    }

    const user = database.users[username];

    res.json({
        ok: true,
        user: {
            username: username,
            createdAt: user.createdAt,
            lastSeen: user.lastSeen || null,
            online: !!onlineUsers[username]
        }
    });
});


/* =========================================================
   SOCKET CONNECTION
========================================================= */

io.on("connection", socket => {

    console.log("Connected:", socket.id);


    /* =====================================================
       LOGIN / ACCOUNT
    ===================================================== */

    socket.on("verify_user", username => {

        username = cleanUsername(username);

        if (!username) {
            socket.emit("auth_error", "اكتب اسم المستخدم");
            return;
        }

        if (username.length < 2) {
            socket.emit(
                "auth_error",
                "اسم المستخدم يجب أن يكون حرفين على الأقل"
            );

            return;
        }


        /*
            إذا الحساب مفتوح من مكان آخر:
            نغلق الجلسة القديمة.
        */

        if (
            onlineUsers[username] &&
            onlineUsers[username].socketId !== socket.id
        ) {

            const oldSocket =
                io.sockets.sockets.get(
                    onlineUsers[username].socketId
                );

            if (oldSocket) {
                oldSocket.emit(
                    "account_logged_elsewhere"
                );

                oldSocket.disconnect(true);
            }

            delete onlineUsers[username];
        }


        const now = Date.now();


        if (!database.users[username]) {

            database.users[username] = {
                username: username,
                createdAt: now,
                lastSeen: now
            };

            saveDatabase();

            socket.emit("account_created", {
                username: username
            });

        } else {

            socket.emit("account_existing", {
                username: username
            });

        }


        database.users[username].lastSeen = now;


        socket.username = username;


        onlineUsers[username] = {
            socketId: socket.id,
            lastSeen: now
        };


        socket.join("user:" + username);


        socket.emit("auth_success", username);


        /*
            إرسال البيانات المحفوظة للمستخدم
        */

        const userMessages =
            database.messages.filter(message => {

                if (message.chatType === "group") {
                    return true;
                }

                return (
                    message.username === username ||
                    message.from === username ||
                    message.to === username
                );
            });


        socket.emit(
            "load_history",
            userMessages
        );


        socket.emit(
            "update_users",
            getPublicUsers()
        );


        socket.emit(
            "update_groups",
            getGroups()
        );


        io.emit(
            "update_users",
            getPublicUsers()
        );


        console.log(
            username + " logged in"
        );
    });


    /* =====================================================
       LOGOUT
    ===================================================== */

    socket.on("logout", () => {

        const username = socket.username;

        if (!username) return;


        if (onlineUsers[username]) {
            delete onlineUsers[username];
        }


        if (database.users[username]) {
            database.users[username].lastSeen =
                Date.now();

            saveDatabase();
        }


        socket.emit("logout_success");


        io.emit(
            "update_users",
            getPublicUsers()
        );


        socket.username = null;
    });


    /* =====================================================
       CREATE GROUP
    ===================================================== */

    socket.on("create_group", groupName => {

        const username = socket.username;

        if (!username) return;


        groupName =
            cleanUsername(groupName);


        if (!groupName) return;


        if (
            database.groups.some(
                group =>
                    group.name === groupName
            )
        ) {

            socket.emit(
                "server_error",
                "هذه المجموعة موجودة بالفعل"
            );

            return;
        }


        const group = {
            id: generateId("group"),
            name: groupName,
            owner: username,
            members: [username]
        };


        database.groups.push(group);

        saveDatabase();


        io.emit(
            "update_groups",
            getGroups()
        );
    });


    /* =====================================================
       JOIN GROUP
    ===================================================== */

    socket.on("join_group", groupId => {

        const username = socket.username;

        if (!username) return;


        const group =
            findGroup(groupId);

        if (!group) return;


        if (!group.members.includes(username)) {
            group.members.push(username);
        }


        saveDatabase();


        socket.emit(
            "update_groups",
            getGroups()
        );


        io.emit(
            "update_groups",
            getGroups()
        );
    });


    /* =====================================================
       SEND MESSAGE
    ===================================================== */

    socket.on("send_message", msg => {

        const username = socket.username;

        if (!username) return;

        if (!msg || typeof msg !== "object") {
            return;
        }


        const chat =
            typeof msg.chat === "string"
                ? msg.chat
                : "";


        if (!chat) return;


        const type =
            typeof msg.type === "string"
                ? msg.type
                : "text";


        const message = {

            id: generateId("msg"),

            chat: chat,

            chatType:
                isGroup(chat)
                    ? "group"
                    : "private",

            username: username,

            from: username,

            to:
                isGroup(chat)
                    ? null
                    : chat,

            type: type,

            text:
                typeof msg.text === "string"
                    ? msg.text.slice(0, 10000)
                    : "",

            content:
                typeof msg.content === "string"
                    ? msg.content
                    : null,

            fileName:
                typeof msg.fileName === "string"
                    ? msg.fileName.slice(0, 200)
                    : null,

            time:
                msg.time ||
                new Date().toLocaleTimeString(
                    "ar-IQ",
                    {
                        hour: "2-digit",
                        minute: "2-digit"
                    }
                ),

            createdAt: Date.now()
        };


        /*
            للمجموعات
        */

        if (isGroup(chat)) {

            const group =
                findGroup(chat);

            if (!group) return;


            database.messages.push(message);

            saveDatabase();


            /*
                أرسل لأعضاء المجموعة المتصلين
            */

            group.members.forEach(member => {

                sendToUser(
                    member,
                    "receive_message",
                    message
                );

            });


            return;
        }


        /*
            محادثة خاصة
        */

        database.messages.push(message);

        saveDatabase();


        /*
            المرسل
        */

        socket.emit(
            "receive_message",
            message
        );


        /*
            المستقبل
        */

        if (chat !== username) {

            sendToUser(
                chat,
                "receive_message",
                message
            );

            sendToUser(
                chat,
                "message_notification",
                {
                    from: username,
                    message: message
                }
            );

        }
    });


    /* =====================================================
       EDIT MESSAGE
    ===================================================== */

    socket.on("edit_message", data => {

        const username = socket.username;

        if (!username) return;


        const message =
            database.messages.find(
                item =>
                    item.id === data.id
            );


        if (!message) return;


        if (message.username !== username) {
            return;
        }


        message.text =
            String(data.text || "")
                .slice(0, 10000);


        message.edited = true;


        saveDatabase();


        /*
            تحديث المرسل
        */

        io.emit(
            "message_edited",
            message
        );
    });


    /* =====================================================
       DELETE MESSAGE
    ===================================================== */

    socket.on("delete_message", data => {

        const username = socket.username;

        if (!username) return;


        const index =
            database.messages.findIndex(
                item =>
                    item.id === data.id
            );


        if (index === -1) return;


        const message =
            database.messages[index];


        if (message.username !== username) {
            return;
        }


        database.messages.splice(index, 1);

        saveDatabase();


        io.emit(
            "message_deleted",
            {
                id: message.id
            }
        );
    });


    /* =====================================================
       TYPING
    ===================================================== */

    socket.on("typing", data => {

        const username = socket.username;

        if (!username) return;


        if (!data || !data.chat) return;


        if (isGroup(data.chat)) {

            const group =
                findGroup(data.chat);

            if (!group) return;


            group.members.forEach(member => {

                if (member !== username) {

                    sendToUser(
                        member,
                        "display_typing",
                        {
                            chat: data.chat,
                            username: username
                        }
                    );

                }

            });


        } else {

            sendToUser(
                data.chat,
                "display_typing",
                {
                    chat: data.chat,
                    username: username
                }
            );

        }
    });


    /* =====================================================
       READ MESSAGE
    ===================================================== */

    socket.on("message_read", data => {

        const username = socket.username;

        if (!username) return;

        const message =
            database.messages.find(
                m => m.id === data.id
            );

        if (!message) return;


        if (!message.readBy) {
            message.readBy = [];
        }


        if (!message.readBy.includes(username)) {

            message.readBy.push(username);

            saveDatabase();
        }


        if (message.username !== username) {

            sendToUser(
                message.username,
                "message_read_update",
                {
                    id: message.id,
                    by: username
                }
            );

        }

    });


    /* =====================================================
       CALL: INDIVIDUAL
    ===================================================== */

    socket.on("call_user", data => {

        const from = socket.username;

        if (!from) return;


        const target =
            cleanUsername(data.to);

        if (!target) return;


        if (!isUser(target)) {

            socket.emit(
                "call_error",
                "المستخدم غير موجود"
            );

            return;
        }


        if (!onlineUsers[target]) {

            socket.emit(
                "call_error",
                "المستخدم غير متصل"
            );

            return;
        }


        sendToUser(
            target,
            "incoming_call",
            {
                from: from,
                offer: data.offer,
                type: data.type,
                callId: data.callId || generateId("call")
            }
        );
    });


    /* =====================================================
       CALL ANSWER
    ===================================================== */

    socket.on("make_answer", data => {

        const from = socket.username;

        if (!from) return;


        sendToUser(
            data.to,
            "call_answered",
            {
                answer: data.answer,
                from: from
            }
        );
    });


    /* =====================================================
       ICE
    ===================================================== */

    socket.on("ice_candidate", data => {

        const from = socket.username;

        if (!from) return;


        sendToUser(
            data.to,
            "ice_candidate",
            {
                candidate: data.candidate,
                from: from
            }
        );
    });


    /* =====================================================
       CALL ROOM
    ===================================================== */

    socket.on("create_call_room", data => {

        const username = socket.username;

        if (!username) return;


        const roomId =
            generateId("room");


        const participants = [
            username
        ];


        socket.join("call:" + roomId);


        socket.callRoom = roomId;


        socket.callParticipants =
            participants;


        socket.emit(
            "call_room_created",
            {
                roomId: roomId,
                participants: participants,
                maxParticipants:
                    MAX_CALL_PARTICIPANTS
            }
        );
    });


    /* =====================================================
       INVITE INTO CALL ROOM
    ===================================================== */

    socket.on("invite_to_call", data => {

        const from = socket.username;

        if (!from) return;


        const roomId =
            data.roomId;

        const target =
            cleanUsername(data.to);


        if (!roomId || !target) return;


        /*
            اجلب sockets الموجودة داخل الغرفة
        */

        const room =
            io.sockets.adapter.rooms.get(
                "call:" + roomId
            );


        const count =
            room
                ? room.size
                : 0;


        if (count >= MAX_CALL_PARTICIPANTS) {

            socket.emit(
                "call_error",
                "المكالمة وصلت للحد الأقصى: 4 أشخاص"
            );

            return;
        }


        if (!onlineUsers[target]) {

            socket.emit(
                "call_error",
                "المستخدم غير متصل"
            );

            return;
        }


        sendToUser(
            target,
            "call_invitation",
            {
                roomId: roomId,
                from: from,
                participants:
                    getCallParticipants(roomId)
            }
        );
    });


    /* =====================================================
       GET CALL PARTICIPANTS
    ===================================================== */

    function getCallParticipants(roomId) {

        const room =
            io.sockets.adapter.rooms.get(
                "call:" + roomId
            );


        if (!room) return [];


        const result = [];


        room.forEach(socketId => {

            const s =
                io.sockets.sockets.get(socketId);

            if (
                s &&
                s.username
            ) {

                result.push(
                    s.username
                );

            }

        });


        return result;
    }


    /* =====================================================
       JOIN CALL ROOM
    ===================================================== */

    socket.on("join_call_room", data => {

        const username = socket.username;

        if (!username) return;


        const roomId =
            data.roomId;

        if (!roomId) return;


        const roomName =
            "call:" + roomId;


        const room =
            io.sockets.adapter.rooms.get(
                roomName
            );


        const count =
            room
                ? room.size
                : 0;


        if (count >= MAX_CALL_PARTICIPANTS) {

            socket.emit(
                "call_room_full"
            );

            return;
        }


        socket.join(roomName);


        socket.callRoom = roomId;


        const participants =
            getCallParticipants(roomId);


        socket.emit(
            "call_room_joined",
            {
                roomId: roomId,
                participants: participants
            }
        );


        socket.to(roomName).emit(
            "call_participant_joined",
            {
                username: username
            }
        );
    });


    /* =====================================================
       CALL SIGNALING
    ===================================================== */

    socket.on("call_signal", data => {

        const from = socket.username;

        if (!from) return;


        if (!data.roomId) return;


        socket.to(
            "call:" + data.roomId
        ).emit(
            "call_signal",
            {
                from: from,
                type: data.type,
                data: data.data
            }
        );
    });


    /* =====================================================
       LEAVE CALL ROOM
    ===================================================== */

    socket.on("leave_call_room", data => {

        const username = socket.username;

        if (!username) return;


        const roomId =
            data.roomId ||
            socket.callRoom;


        if (!roomId) return;


        const roomName =
            "call:" + roomId;


        socket.leave(roomName);


        socket.to(roomName).emit(
            "call_participant_left",
            {
                username: username
            }
        );


        socket.callRoom = null;
    });


    /* =====================================================
       CALL RING
    ===================================================== */

    socket.on("ring_call", data => {

        const from = socket.username;

        if (!from) return;


        if (!data.to) return;


        sendToUser(
            data.to,
            "call_ring",
            {
                from: from
            }
        );
    });


    /* =====================================================
       TURN ALERT
    ===================================================== */

    socket.on(
        "turn_connection_active",
        data => {

            const from =
                socket.username;

            if (!from) return;


            if (data.to) {

                sendToUser(
                    data.to,
                    "show_turn_alert"
                );

            }


            socket.emit(
                "show_turn_alert"
            );
        }
    );


    /* =====================================================
       DISCONNECT
    ===================================================== */

    socket.on("disconnect", () => {

        const username =
            socket.username;


        if (!username) return;


        /*
            إذا نفس الجلسة
        */

        if (
            onlineUsers[username] &&
            onlineUsers[username].socketId === socket.id
        ) {

            delete onlineUsers[username];


            if (database.users[username]) {

                database.users[username].lastSeen =
                    Date.now();

                saveDatabase();
            }


            /*
                إذا داخل مكالمة
            */

            if (socket.callRoom) {

                socket.to(
                    "call:" + socket.callRoom
                ).emit(
                    "call_participant_left",
                    {
                        username: username
                    }
                );

            }


            io.emit(
                "update_users",
                getPublicUsers()
            );

        }


        console.log(
            "Disconnected:",
            username
        );
    });

});


/* =========================================================
   START SERVER
========================================================= */

server.listen(PORT, "0.0.0.0", () => {

    console.log(
        "===================================="
    );

    console.log(
        "Server running on port " + PORT
    );

    console.log(
        "Developer: محمد حسنين"
    );

    console.log(
        "Max call participants: " +
        MAX_CALL_PARTICIPANTS
    );

    console.log(
        "Data file: " + DATA_FILE
    );

    console.log(
        "===================================="
    );
});
