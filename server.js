const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

// Берем секретные данные из настроек хостинга
const BOT_TOKEN = process.env.BOT_TOKEN; 
// Если URL не задан, сервер попытается определить его сам, но лучше задать в Render
const WEB_APP_URL = process.env.WEB_APP_URL; 
const ADMIN_ID = process.env.ADMIN_ID; // Твой ID

if (!BOT_TOKEN) {
    console.error('ОШИБКА: Не задан BOT_TOKEN в переменных окружения!');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.json());

// Временная база данных (ВНИМАНИЕ: На бесплатном Render она стирается при перезагрузке!)
const users = {}; 

// Команда /start
bot.start((ctx) => {
    const userId = ctx.from.id;
    if (!users[userId]) {
        users[userId] = { balance: 0, username: ctx.from.username };
    }
    
    ctx.reply('Привет! Заработай голду для Project Evolution тут 👇', {
        reply_markup: {
            inline_keyboard: [
                [{ text: "💰 Открыть приложение", web_app: { url: WEB_APP_URL } }]
            ]
        }
    });
});

app.get('/api/balance/:userId', (req, res) => {
    const userId = req.params.userId;
    const user = users[userId] || { balance: 0 };
    res.json(user);
});

app.post('/api/reward', (req, res) => {
    const { userId } = req.body;
    if (!users[userId]) users[userId] = { balance: 0 };
    users[userId].balance += 10;
    res.json({ success: true, newBalance: users[userId].balance });
});

app.post('/api/withdraw', (req, res) => {
    const { userId, gameId } = req.body;
    const user = users[userId];

    if (!user || user.balance < 100) {
        return res.json({ success: false, message: 'Минимум 100 монет' });
    }

    const amount = user.balance;
    user.balance = 0;

    // Шлем уведомление админу
    if (ADMIN_ID) {
        bot.telegram.sendMessage(ADMIN_ID, 
            `⚠️ ЗАЯВКА!\nUser: @${user.username}\nGameID: ${gameId}\nСумма: ${amount}`
        ).catch(err => console.error(err));
    }

    res.json({ success: true });
});

// Настройка для Render (он сам выдает PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Запуск бота через Webhook (для Render это надежнее, чем Polling)
// Но для простоты оставим launch, на Render в бесплатном тарифе это иногда сбоит, но работает.
bot.launch().then(() => console.log('Bot started'));

// Остановка при выключении сервера
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));