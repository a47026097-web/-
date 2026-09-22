```js
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 8080;

/*
====================================================
الملفات
====================================================
*/

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, "users.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const GROUPS_FILE = path.join(DATA_DIR, "groups.json");

/*
====================================================
قراءة / حفظ البيانات
====================================================
*/

function loadJSON(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(
                file,
                JSON.stringify(fallback, null, 2),
                "utf8"
            );

            return fallback;
        }

        return JSON.parse(
            fs.readFileSync(file, "utf8")
        );

    } catch (error) {
        console.error("خطأ بقراءة:", file, error);
        return fallback;
    }
}

function saveJSON(file, data) {
    try {
        fs.writeFileSync(
            file,
            JSON.stringify(data, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("خطأ بالحفظ:", file, error);
    }
}

/*
====================================================
البيانات
====================================================
*/

const accounts = loadJSON(USERS_FILE, {});
const messages = loadJSON(MESSAGES_FILE, []);

const groups = loadJSON(
    GROUPS_FILE,
    ["الدردشة العامة"]
);

/*
====================================================
المستخدمون المتصلون
====================================================
*/

const onlineUsers = {};

/*
====================================================
AI
====================================================
*/

/*
ضع مفتاح الذكاء الاصطناعي في Environment Variable:

Windows CMD:
set OPENAI_API_KEY=YOUR_KEY

PowerShell:
$env:OPENAI_API_KEY="YOUR_KEY"

ولا تضع المفتاح داخل index.html.
*/

const OPENAI_API_KEY =
    process.env.OPENAI_API_KEY || "";

const AI_MODEL =
    process.env.OPENAI_MODEL ||
    "gpt-5.6-luna";


/*
====================================================
Express
====================================================
*/

app.use(express.json({ limit: "12mb" }));

app.use(
    express.static(__dirname)
);


/*
====================================================
Socket.IO
====================================================
*/

io.on("connection", (socket) => {

    console.log(
        "اتصال جديد:",
        socket.id
    );


    /*
    ================================================
    تسجيل الدخول
    ================================================
    */

    socket.on("verify_user", (username) => {

        username =
            String(username || "")
                .trim()
                .slice(0, 30);

        if (!username) {

            socket.emit(
                "auth_error",
                "اكتب اسم مستخدم."
            );

            return;
        }


        /*
        إذا الحساب موجود نخليه يدخل.
        إذا جديد ننشئ حساب.
        */

        if (!accounts[username]) {

            accounts[username] = {

                username: username,

                createdAt:
                    new Date().toISOString(),

                lastSeen:
                    new Date().toISOString()

            };

            saveJSON(
                USERS_FILE,
                accounts
            );
        }


        /*
        إذا الاسم مستخدم حالياً
        نرفض الاتصال الثاني.
        */

        if (
            onlineUsers[username] &&
            onlineUsers[username].id !== socket.id
        ) {

            socket.emit(
                "auth_error",
                "هذا الاسم مستخدم حالياً."
            );

            return;
        }


        socket.username =
            username;


        onlineUsers[username] = {

            id: socket.id,

            status: "متصل",

            lastSeen:
                new Date().toISOString()

        };


        socket.emit(
            "auth_success",
            username
        );


        socket.emit(
            "load_history",
            messages
        );


        io.emit(
            "update_users",
            onlineUsers
        );


        io.emit(
            "update_groups",
            groups
        );

    });


    /*
    ================================================
    الرسائل
    ================================================
    */

    socket.on(
        "send_message",
        (data) => {

            if (!socket.username)
                return;


            const message = {

                id:
                    Date.now().toString() +
                    "-" +
                    Math.random()
                        .toString(36)
                        .slice(2),

                chat:
                    data.chat ||
                    "الدردشة العامة",

                username:
                    socket.username,

                type:
                    data.type ||
                    "text",

                text:
                    data.text ||
                    "",

                content:
                    data.content ||
                    "",

                fileName:
                    data.fileName ||
                    "",

                time:
                    new Date()
                        .toLocaleTimeString(
                            "ar-IQ",
                            {
                                hour: "2-digit",
                                minute: "2-digit"
                            }
                        ),

                status:
                    "sent",

                createdAt:
                    new Date().toISOString()

            };


            messages.push(message);


            /*
            لا نخلي ملف الرسائل يكبر بلا نهاية.
            */

            if (messages.length > 5000) {

                messages.splice(
                    0,
                    messages.length - 5000
                );

            }


            saveJSON(
                MESSAGES_FILE,
                messages
            );


            io.emit(
                "receive_message",
                message
            );

        }
    );


    /*
    ================================================
    تعديل رسالة
    ================================================
    */

    socket.on(
        "edit_message",
        (data) => {

            const message =
                messages.find(
                    m =>
                        m.id ===
                        data.messageId
                );


            if (!message)
                return;


            if (
                message.username !==
                socket.username
            )
                return;


            message.text =
                String(data.text || "")
                    .trim();


            message.edited =
                true;


            saveJSON(
                MESSAGES_FILE,
                messages
            );


            io.emit(
                "message_edited",
                message
            );

        }
    );


    /*
    ================================================
    حذف رسالة
    ================================================
    */

    socket.on(
        "delete_message",
        (data) => {

            const index =
                messages.findIndex(
                    m =>
                        m.id ===
                        data.messageId
                );


            if (index === -1)
                return;


            if (
                messages[index].username !==
                socket.username
            )
                return;


            const id =
                messages[index].id;


            messages.splice(
                index,
                1
            );


            saveJSON(
                MESSAGES_FILE,
                messages
            );


            io.emit(
                "message_deleted",
                id
            );

        }
    );


    /*
    ================================================
    الكتابة
    ================================================
    */

    socket.on(
        "typing",
        (data) => {

            socket.broadcast.emit(
                "display_typing",
                {
                    chat:
                        data.chat,

                    username:
                        socket.username
                }
            );

        }
    );


    /*
    ================================================
    إنشاء مجموعة
    ================================================
    */

    socket.on(
        "create_group",
        (data) => {

            const name =
                typeof data === "string"
                    ? data
                    : data?.name;


            if (!name)
                return;


            const cleanName =
                String(name)
                    .trim()
                    .slice(0, 50);


            if (!cleanName)
                return;


            if (
                groups.includes(
                    cleanName
                )
            ) {

                socket.emit(
                    "group_error",
                    "هذه المجموعة موجودة."
                );

                return;
            }


            groups.push(
                cleanName
            );


            saveJSON(
                GROUPS_FILE,
                groups
            );


            io.emit(
                "update_groups",
                groups
            );

        }
    );


    /*
    ================================================
    مكالمات فردية
    ================================================
    */

    socket.on(
        "call_user",
        (data) => {

            if (!socket.username)
                return;


            const target =
                onlineUsers[data.to];


            if (!target)
                return;


            io.to(target.id).emit(
                "incoming_call",
                {

                    from:
                        socket.username,

                    offer:
                        data.offer,

                    type:
                        data.type ||
                        "audio"

                }
            );

        }
    );


    socket.on(
        "make_answer",
        (data) => {

            const target =
                onlineUsers[data.to];


            if (!target)
                return;


            io.to(target.id).emit(
                "call_answered",
                {

                    from:
                        socket.username,

                    answer:
                        data.answer

                }
            );

        }
    );


    socket.on(
        "ice_candidate",
        (data) => {

            const target =
                onlineUsers[data.to];


            if (!target)
                return;


            io.to(target.id).emit(
                "ice_candidate",
                {

                    from:
                        socket.username,

                    candidate:
                        data.candidate

                }
            );

        }
    );


    /*
    ================================================
    TURN
    ================================================
    */

    socket.on(
        "turn_connection_active",
        (data) => {

            const target =
                onlineUsers[data.to];


            if (target) {

                io.to(target.id).emit(
                    "show_turn_alert"
                );

            }


            socket.emit(
                "show_turn_alert"
            );

        }
    );


    /*
    ================================================
    دعوة للمكالمة الجماعية
    ================================================
    */

    socket.on(
        "invite_to_call",
        (data) => {

            const target =
                onlineUsers[data.to];


            if (!target)
                return;


            io.to(target.id).emit(
                "call_invite",
                {

                    from:
                        socket.username,

                    participants:
                        data.participants ||
                        [],

                    type:
                        data.type ||
                        "audio"

                }
            );

        }
    );


    socket.on(
        "join_group_call",
        (data) => {

            io.emit(
                "group_call_participant_joined",
                {

                    participants:
                        data.participants ||
                        []

                }
            );

        }
    );


    socket.on(
        "call_mic_status",
        (data) => {

            for (
                const username
                of data.participants || []
            ) {

                const target =
                    onlineUsers[username];


                if (
                    target &&
                    username !== socket.username
                ) {

                    io.to(target.id).emit(
                        "participant_mic_status",
                        {

                            username:
                                socket.username,

                            muted:
                                !!data.muted

                        }
                    );

                }

            }

        }
    );


    socket.on(
        "call_camera_status",
        (data) => {

            for (
                const username
                of data.participants || []
            ) {

                const target =
                    onlineUsers[username];


                if (
                    target &&
                    username !== socket.username
                ) {

                    io.to(target.id).emit(
                        "participant_camera_status",
                        {

                            username:
                                socket.username,

                            enabled:
                                !!data.enabled

                        }
                    );

                }

            }

        }
    );


    socket.on(
        "end_call",
        (data) => {

            for (
                const username
                of data.participants || []
            ) {

                const target =
                    onlineUsers[username];


                if (
                    target &&
                    username !== socket.username
                ) {

                    io.to(target.id).emit(
                        "call_ended"
                    );

                }

            }

        }
    );


    /*
    ================================================
    AI CHAT
    ================================================
    */

    socket.on(
        "ai_message",
        async (data) => {

            if (!socket.username)
                return;


            const text =
                String(data.text || "")
                    .trim();


            if (!text)
                return;


            if (!OPENAI_API_KEY) {

                socket.emit(
                    "ai_error",
                    "مفتاح الذكاء الاصطناعي غير موجود في السيرفر."
                );

                return;
            }


            /*
            نأخذ آخر رسائل AI فقط
            حتى لا يكبر الطلب بلا نهاية.
            */

            let history =
                Array.isArray(
                    data.history
                )
                ? data.history
                : [];


            history =
                history
                    .slice(-12)
                    .map(item => {

                        return {

                            role:
                                item.role === "assistant"
                                    ? "assistant"
                                    : "user",

                            content:
                                String(
                                    item.content || ""
                                )

                        };

                    });


            /*
            نضيف رسالة المستخدم الحالية
            */

            history.push({

                role: "user",

                content: text

            });


            try {

                socket.emit(
                    "ai_status",
                    "جاري التفكير..."
                );


                const response =
                    await fetch(
                        "https://api.openai.com/v1/responses",
                        {

                            method: "POST",

                            headers: {

                                "Content-Type":
                                    "application/json",

                                "Authorization":
                                    "Bearer " +
                                    OPENAI_API_KEY

                            },

                            body:
                                JSON.stringify({

                                    model:
                                        AI_MODEL,

                                    instructions:
                                        "أنت مساعد داخل تطبيق دردشة عربي. أجب بوضوح وباختصار مناسب، ويمكنك استخدام العربية العراقية عندما يكون ذلك مناسباً.",

                                    input:
                                        history

                                })

                        }
                    );


                const result =
                    await response.json();


                if (!response.ok) {

                    console.error(
                        "OpenAI error:",
                        result
                    );


                    socket.emit(
                        "ai_error",
                        "حدث خطأ من خدمة الذكاء الاصطناعي."
                    );

                    return;
                }


                /*
                Responses API يعيد output.
                نبحث عن النص داخل عناصر الإخراج.
                */

                let answer = "";


                if (
                    typeof result.output_text ===
                    "string"
                ) {

                    answer =
                        result.output_text;

                } else if (
                    Array.isArray(
                        result.output
                    )
                ) {

                    for (
                        const item
                        of result.output
                    ) {

                        if (
                            !Array.isArray(
                                item.content
                            )
                        )
                            continue;


                        for (
                            const content
                            of item.content
                        ) {

                            if (
                                typeof content.text ===
                                "string"
                            ) {

                                answer +=
                                    content.text;

                            }

                        }

                    }

                }


                answer =
                    answer.trim();


                if (!answer) {

                    answer =
                        "ما قدرت أحصل على رد من الذكاء الاصطناعي.";

                }


                socket.emit(
                    "ai_response",
                    {

                        text:
                            answer,

                        time:
                            new Date()
                                .toLocaleTimeString(
                                    "ar-IQ",
                                    {
                                        hour:
                                            "2-digit",

                                        minute:
                                            "2-digit"
                                    }
                                )

                    }
                );


            } catch (error) {

                console.error(
                    "AI request error:",
                    error
                );


                socket.emit(
                    "ai_error",
                    "تعذر الاتصال بخدمة الذكاء الاصطناعي."
                );

            }

        }
    );


    /*
    ================================================
    Disconnect
    ================================================
    */

    socket.on(
        "disconnect",
        () => {

            if (
                socket.username &&
                onlineUsers[
                    socket.username
                ]
            ) {

                accounts[
                    socket.username
                ].lastSeen =
                    new Date().toISOString();


                saveJSON(
                    USERS_FILE,
                    accounts
                );


                delete onlineUsers[
                    socket.username
                ];


                io.emit(
                    "update_users",
                    onlineUsers
                );

            }


            console.log(
                "انقطع:",
                socket.id
            );

        }
    );

});


/*
====================================================
SERVER
====================================================
*/

server.listen(
    PORT,
    () => {

        console.log(
            "================================="
        );

        console.log(
            "دردشة يعمل على المنفذ:",
            PORT
        );

        console.log(
            "AI:",
            OPENAI_API_KEY
                ? "مفعل"
                : "غير مفعل"
        );

        console.log(
            "AI Model:",
            AI_MODEL
        );

        console.log(
            "================================="
        );

    }
);
```
