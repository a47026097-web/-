const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, ".")));

const DATA_FILE = path.join(__dirname, "chat-data.json");

// ==============================
// تحميل البيانات
// ==============================

let database = {
    users: {},
    messages: [],
    groups: ["الدردشة العامة"]
};

function loadDatabase() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, "utf8");

            if (data.trim()) {
                const parsed = JSON.parse(data);

                database = {
                    users: parsed.users || {},
                    messages: parsed.messages || [],
                    groups: parsed.groups || ["الدردشة العامة"]
                };
            }
        }
    } catch (error) {
        console.error("خطأ بتحميل قاعدة البيانات:", error);
    }
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("خطأ بحفظ قاعدة البيانات:", error);
    }
}

loadDatabase();

// المستخدمون المتصلون حاليًا
const onlineUsers = {};

// ==============================
// أدوات مساعدة
// ==============================

function makeId(prefix = "id") {
    return (
        prefix +
        "_" +
        Date.now() +
        "_" +
        Math.random().toString(36).substring(2, 10)
    );
}

function cleanUsername(username) {
    if (typeof username !== "string") return "";

    return username
        .trim()
        .replace(/[<>]/g, "")
        .substring(0, 30);
}

function cleanText(text) {
    if (typeof text !== "string") return "";

    return text
        .trim()
        .substring(0, 5000);
}

function isUserOnline(username) {
    return !!onlineUsers[username];
}

function getUsersForClient() {
    const result = {};

    for (const username in database.users) {
        const user = database.users[username];

        result[username] = {
            status: onlineUsers[username] ? "متصل" : "غير متصل",
            lastSeen: user.lastSeen || null
        };
    }

    for (const username in onlineUsers) {
        if (!result[username]) {
            result[username] = {
                status: "متصل",
                lastSeen: null
            };
        }
    }

    return result;
}

function sendUsersUpdate() {
    io.emit("update_users", getUsersForClient());
}

function sendGroupsUpdate() {
    io.emit("update_groups", database.groups);
}

// ==============================
// Socket.IO
// ==============================

io.on("connection", (socket) => {

    console.log("Client connected:", socket.id);

    // ==========================
    // تسجيل الدخول
    // ==========================

    socket.on("verify_user", (username) => {

        username = cleanUsername(username);

        if (!username) {
            socket.emit("auth_error", "اسم المستخدم غير صالح");
            return;
        }

        // إذا نفس الاسم موجود على جهاز آخر
        if (
            onlineUsers[username] &&
            onlineUsers[username].socketId !== socket.id
        ) {
            socket.emit(
                "auth_error",
                "هذا الاسم مستخدم حاليًا على جهاز آخر"
            );
            return;
        }

        socket.username = username;

        if (!database.users[username]) {
            database.users[username] = {
                username: username,
                createdAt: Date.now(),
                lastSeen: null
            };

            saveDatabase();
        }

        onlineUsers[username] = {
            socketId: socket.id
        };

        socket.emit("auth_success", username);

        // إرسال البيانات القديمة
        socket.emit("load_history", database.messages);

        socket.emit("update_users", getUsersForClient());
        socket.emit("update_groups", database.groups);

        sendUsersUpdate();

        console.log(username + " دخل إلى الدردشة");
    });

    // ==========================
    // إنشاء مجموعة
    // ==========================

    socket.on("create_group", (groupName) => {

        if (!socket.username) return;

        groupName = cleanText(groupName);

        if (!groupName) return;

        if (database.groups.includes(groupName)) {
            return;
        }

        database.groups.push(groupName);

        saveDatabase();

        sendGroupsUpdate();
    });

    // ==========================
    // إرسال رسالة
    // ==========================

    socket.on("send_message", (msgData) => {

        if (!socket.username) return;
        if (!msgData) return;

        const message = {
            id: makeId("msg"),
            chat: msgData.chat || "الدردشة العامة",
            username: socket.username,
            type: msgData.type || "text",
            text: msgData.text ? cleanText(msgData.text) : "",
            content: msgData.content || "",
            time: msgData.time || new Date().toLocaleTimeString("ar-IQ", {
                hour: "2-digit",
                minute: "2-digit"
            }),
            timestamp: Date.now(),

            // حالة الرسالة
            status: "sent",

            edited: false,
            deleted: false
        };

        // منع الملفات الضخمة جدًا
        if (
            typeof message.content === "string" &&
            message.content.length > 20 * 1024 * 1024
        ) {
            socket.emit("message_error", "الملف كبير جدًا");
            return;
        }

        database.messages.push(message);

        saveDatabase();

        // المرسل
        socket.emit("message_status", {
            id: message.id,
            status: "sent"
        });

        // إرسال للجميع
        io.emit("receive_message", message);

        // إذا كانت رسالة خاصة
        if (
            message.chat !== "الدردشة العامة" &&
            !database.groups.includes(message.chat)
        ) {

            const target = onlineUsers[message.chat];

            if (target) {
                io.to(target.socketId).emit("message_status", {
                    id: message.id,
                    status: "delivered"
                });
            }
        } else {
            // المجموعة
            socket.emit("message_status", {
                id: message.id,
                status: "delivered"
            });
        }
    });

    // ==========================
    // قراءة الرسالة
    // ==========================

    socket.on("mark_read", (data) => {

        if (!data || !data.messageId) return;

        const message = database.messages.find(
            m => m.id === data.messageId
        );

        if (!message) return;

        message.status = "read";

        saveDatabase();

        io.emit("message_status", {
            id: message.id,
            status: "read"
        });
    });

    // ==========================
    // تعديل رسالة
    // ==========================

    socket.on("edit_message", (data) => {

        if (!socket.username) return;
        if (!data || !data.id) return;

        const message = database.messages.find(
            m => m.id === data.id
        );

        if (!message) return;

        if (message.username !== socket.username) {
            return;
        }

        if (message.deleted) return;

        message.text = cleanText(data.text);
        message.edited = true;
        message.editedAt = Date.now();

        saveDatabase();

        io.emit("message_edited", {
            id: message.id,
            text: message.text,
            edited: true
        });
    });

    // ==========================
    // حذف رسالة
    // ==========================

    socket.on("delete_message", (data) => {

        if (!socket.username) return;
        if (!data || !data.id) return;

        const message = database.messages.find(
            m => m.id === data.id
        );

        if (!message) return;

        if (message.username !== socket.username) {
            return;
        }

        message.deleted = true;
        message.text = "";
        message.content = "";

        saveDatabase();

        io.emit("message_deleted", {
            id: message.id
        });
    });

    // ==========================
    // مؤشر الكتابة
    // ==========================

    socket.on("typing", (data) => {

        if (!socket.username) return;

        socket.broadcast.emit("display_typing", {
            chat: data.chat,
            username: socket.username
        });
    });

    // ==========================
    // البحث
    // ==========================

    socket.on("search_messages", (query) => {

        if (!socket.username) return;

        query = cleanText(query).toLowerCase();

        if (!query) {
            socket.emit("search_results", []);
            return;
        }

        const results = database.messages.filter(message => {

            if (message.deleted) return false;

            const text =
                (message.text || "") +
                " " +
                (message.username || "");

            return text.toLowerCase().includes(query);
        });

        socket.emit("search_results", results.slice(-100));
    });

    // =========================================================
    // WebRTC
    // =========================================================

    socket.on("call_user", (data) => {

        if (!socket.username) return;
        if (!data || !data.to) return;

        const targetUser = onlineUsers[data.to];

        if (!targetUser) {
            socket.emit("call_error", "المستخدم غير متصل");
            return;
        }

        io.to(targetUser.socketId).emit("incoming_call", {
            from: socket.username,
            offer: data.offer,
            type: data.type
        });
    });

    socket.on("make_answer", (data) => {

        if (!data || !data.to) return;

        const targetUser = onlineUsers[data.to];

        if (!targetUser) return;

        io.to(targetUser.socketId).emit("call_answered", {
            answer: data.answer,
            from: socket.username
        });
    });

    socket.on("ice_candidate", (data) => {

        if (!data || !data.to) return;

        const targetUser = onlineUsers[data.to];

        if (!targetUser) return;

        io.to(targetUser.socketId).emit("ice_candidate", {
            candidate: data.candidate,
            from: socket.username
        });
    });

    // TURN
    socket.on("turn_connection_active", (data) => {

        if (!data || !data.to) return;

        const targetUser = onlineUsers[data.to];

        if (targetUser) {
            io.to(targetUser.socketId).emit("show_turn_alert");
        }

        socket.emit("show_turn_alert");
    });

    // إنهاء المكالمة
    socket.on("call_ended", (data) => {

        if (!data || !data.to) return;

        const targetUser = onlineUsers[data.to];

        if (targetUser) {
            io.to(targetUser.socketId).emit("call_ended", {
                from: socket.username
            });
        }
    });

    // ==========================
    // Disconnect
    // ==========================

    socket.on("disconnect", () => {

        if (!socket.username) return;

        const username = socket.username;

        if (
            onlineUsers[username] &&
            onlineUsers[username].socketId === socket.id
        ) {
            delete onlineUsers[username];

            if (database.users[username]) {
                database.users[username].lastSeen = Date.now();
            }

            saveDatabase();

            sendUsersUpdate();

            io.emit("user_last_seen", {
                username: username,
                lastSeen: database.users[username]
                    ? database.users[username].lastSeen
                    : Date.now()
            });
        }

        console.log(username + " خرج من الدردشة");
    });
});

// ==============================
// تشغيل السيرفر
// ==============================

http.listen(PORT, () => {
    console.log("=================================");
    console.log("Chat server running");
    console.log("Port: " + PORT);
    console.log("=================================");
});
