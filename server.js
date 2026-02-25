const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL; 
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const DATABASE_URL = process.env.DATABASE_URL;

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ---
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.json());

// --- БОТ ЛОГИКА ---
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    // Можно добавить username, если нужно
    ctx.reply('💎 Открыть приложение:', {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🚀 Запустить", web_app: { url: WEB_APP_URL } }]
            ]
        }
    });
});

// --- API ---
app.get('/api/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        
        if (result.rows.length === 0) {
            await pool.query('INSERT INTO users (id, balance) VALUES ($1, 0) ON CONFLICT (id) DO NOTHING', [userId]);
            return res.json({ balance: 0, isAdmin: false, minWithdraw: 1000 });
        }
        const user = result.rows[0];
        const isAdmin = (parseInt(userId) === ADMIN_ID);
        res.json({ balance: parseFloat(user.balance), isAdmin, minWithdraw: isAdmin ? 10 : 1000 });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/reward', async (req, res) => {
    try {
        const { userId } = req.body;
        const reward = Math.floor((Math.random() * 0.6 + 1) * 10) / 10;
        await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2', [reward, userId]);
        const resUser = await pool.query('SELECT balance FROM users WHERE id = $1', [userId]);
        res.json({ success: true, reward, newBalance: parseFloat(resUser.rows[0].balance) });
    } catch (e) {
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/withdraw', async (req, res) => {
    const { userId, gameId } = req.body;
    // Логику вывода можно сократить для теста, главное чтобы сервер жил
    bot.telegram.sendMessage(ADMIN_ID, `Вывод: ${userId} GameID: ${gameId}`);
    await pool.query('UPDATE users SET balance = 0 WHERE id = $1', [userId]);
    res.json({ success: true });
});

// --- ГЛАВНОЕ: WEBHOOK ВМЕСТО LAUNCH ---
// Мы создаем секретный путь, куда Телеграм будет стучаться
const secretPath = `/telegraf/${bot.secretPathComponent()}`;
app.use(bot.webhookCallback(secretPath));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    
    // Если переменная WEB_APP_URL задана, устанавливаем вебхук
    if (WEB_APP_URL) {
        const webhookUrl = `${WEB_APP_URL}${secretPath}`;
        console.log(`Setting webhook: ${webhookUrl}`);
        await bot.telegram.setWebhook(webhookUrl);
        console.log(`✅ Webhook успешно установлен!`);
    } else {
        console.log(`❌ WEB_APP_URL не задан, вебхук не установлен!`);
    }
});

// Эти строки предотвращают зависание процессов
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));