const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN;
// ВАЖНО: WEB_APP_URL должен быть без слэша в конце (например: https://myapp.onrender.com)
const WEB_APP_URL = process.env.WEB_APP_URL; 
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const DATABASE_URL = process.env.DATABASE_URL;

// Проверки
if (!WEB_APP_URL) {
    console.error('❌ ОШИБКА: Не задан WEB_APP_URL в настройках Render!');
    process.exit(1);
}

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
    const username = ctx.from.username || 'Anon';

    try {
        await pool.query(
            'INSERT INTO users (id, username, balance) VALUES ($1, $2, 0) ON CONFLICT (id) DO NOTHING',
            [userId, username]
        );
        
        ctx.reply('💎 Добро пожаловать! Жми кнопку ниже.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Запустить", web_app: { url: WEB_APP_URL } }]
                ]
            }
        });
    } catch (e) {
        console.error('Ошибка БД:', e);
    }
});

// --- API ---
app.get('/api/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        
        if (result.rows.length === 0) {
            await pool.query('INSERT INTO users (id, balance) VALUES ($1, 0)', [userId]);
            return res.json({ balance: 0, isAdmin: false, minWithdraw: 1000 });
        }

        const user = result.rows[0];
        const isAdmin = (parseInt(userId) === ADMIN_ID);
        const minWithdraw = isAdmin ? 10 : 1000;

        res.json({ balance: parseFloat(user.balance.toFixed(1)), isAdmin, minWithdraw });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/reward', async (req, res) => {
    try {
        const { userId } = req.body;
        const reward = Math.floor((Math.random() * 0.6 + 1) * 10) / 10;
        const result = await pool.query(
            'UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance',
            [reward, userId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'No user' });
        res.json({ success: true, reward, newBalance: parseFloat(result.rows[0].balance.toFixed(1)) });
    } catch (e) {
        res.status(500).json({ error: 'Error' });
    }
});

app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, gameId } = req.body;
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) return res.status(404).json({ message: 'User error' });
        
        const user = userRes.rows[0];
        const isAdmin = (parseInt(userId) === ADMIN_ID);
        const minWithdraw = isAdmin ? 10 : 1000;

        if (user.balance < minWithdraw) return res.json({ success: false, message: `Минимум: ${minWithdraw} G` });

        await pool.query('UPDATE users SET balance = 0 WHERE id = $1', [userId]);

        bot.telegram.sendMessage(ADMIN_ID, 
            `💸 ЗАЯВКА: @${user.username}\nID: ${userId}\nGameID: ${gameId}\nСумма: ${user.balance} G`
        ).catch(err => console.error(err));

        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: 'Ошибка сервера' });
    }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const countRes = await pool.query('SELECT COUNT(*) FROM users');
        const sumRes = await pool.query('SELECT SUM(balance) FROM users');
        res.json({ users: countRes.rows[0].count, debt: parseFloat(sumRes.rows[0].sum || 0).toFixed(1) });
    } catch (e) {
        res.json({ users: 0, debt: 0 });
    }
});

// --- ВАЖНО: НАСТРОЙКА WEBHOOK ---
// Мы не используем bot.launch(), мы встраиваем бота в Express
const SECRET_PATH = `/bot${BOT_TOKEN}`;
app.use(bot.webhookCallback(SECRET_PATH));

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    
    // Сообщаем Телеграму, куда слать данные
    // Это сработает только если WEB_APP_URL на Render указан верно!
    const webhookUrl = `${WEB_APP_URL}${SECRET_PATH}`;
    console.log(`Setting webhook to: ${webhookUrl}`);
    
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`✅ Webhook set!`);
});