const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL; 
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Бот: Начало
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    await pool.query('INSERT INTO users (id, username, balance) VALUES ($1, $2, 0) ON CONFLICT (id) DO NOTHING', [userId, ctx.from.username]);
    ctx.reply('💎 Добро пожаловать! Используйте кнопку ниже для входа:', {
        reply_markup: { inline_keyboard: [[{ text: "🚀 Запустить приложение", web_app: { url: WEB_APP_URL } }]] }
    });
});

// API: Данные пользователя
app.get('/api/user/:id', async (req, res) => {
    const userId = req.params.id;
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const isAdmin = (parseInt(userId) === ADMIN_ID);
    if (result.rows.length === 0) return res.json({ balance: 0, isAdmin });
    res.json({ balance: parseFloat(result.rows[0].balance), isAdmin, minWithdraw: isAdmin ? 10 : 1000 });
});

// API: Награда
app.post('/api/reward', async (req, res) => {
    const { userId } = req.body;
    const reward = Math.floor((Math.random() * 0.6 + 1) * 10) / 10;
    const result = await pool.query('UPDATE users SET balance = balance + $1 WHERE id = $2 RETURNING balance', [reward, userId]);
    res.json({ success: true, reward, newBalance: parseFloat(result.rows[0].balance) });
});

// API: Вывод
app.post('/api/withdraw', async (req, res) => {
    const { userId, amount, imageBase64 } = req.body;
    const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
    const minWithdraw = userId == ADMIN_ID ? 10 : 1000;
    
    // Проверки на дурака
    if (user.balance < minWithdraw || amount > user.balance || amount < minWithdraw) {
        return res.json({ success: false, message: 'Некорректная сумма или недостаточно средств' });
    }
    
    // Списываем баланс ТОЧНО на сумму вывода
    await pool.query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amount, userId]);
    
    // Сохраняем заявку со скриншотом в базу
    await pool.query('INSERT INTO withdrawals (user_id, amount, image_base64) VALUES ($1, $2, $3)',[userId, amount, imageBase64]);
    
    bot.telegram.sendMessage(ADMIN_ID, `💸 НОВАЯ ЗАЯВКА НА ВЫВОД\nID: ${userId}\nСумма: ${amount} G\nЗайдите в админ-панель Mini App для проверки.`);
    res.json({ success: true });
});

// --- СИСТЕМА ПОДДЕРЖКИ ---

// Отправить сообщение
app.post('/api/support/send', async (req, res) => {
    const { userId, text, isAdminReply, targetUserId } = req.body;
    // Если это ответ админа, сохраняем как от ADMIN_ID для targetUserId
    const finalUserId = isAdminReply ? targetUserId : userId;
    const senderId = userId;

    await pool.query('INSERT INTO support_messages (user_id, sender_id, message) VALUES ($1, $2, $3)', [finalUserId, senderId, text]);

    if (!isAdminReply) {
        bot.telegram.sendMessage(ADMIN_ID, `📩 Новое сообщение в техподдержку от ${userId}:\n\n"${text}"\n\nОтветьте в админ-панели приложения.`);
    } else {
        bot.telegram.sendMessage(targetUserId, `👨‍💻 Техподдержка прислала вам ответ! Проверьте в приложении.`);
    }
    res.json({ success: true });
});

// Получить историю сообщений (для юзера или админа)
app.get('/api/support/messages/:userId', async (req, res) => {
    const result = await pool.query('SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC', [req.params.userId]);
    res.json(result.rows);
});

// Получить список всех тикетов (только для админа)
app.get('/api/admin/support-list', async (req, res) => {
    const result = await pool.query('SELECT DISTINCT user_id FROM support_messages ORDER BY user_id DESC');
    res.json(result.rows);
});

app.get('/api/admin/stats', async (req, res) => {
    const users = await pool.query('SELECT COUNT(*) FROM users');
    const debt = await pool.query('SELECT SUM(balance) FROM users');
    res.json({ users: users.rows[0].count, debt: parseFloat(debt.rows[0].sum || 0).toFixed(1) });
});
// Получить список заявок
app.get('/api/admin/withdrawals', async (req, res) => {
    const result = await pool.query("SELECT * FROM withdrawals WHERE status = 'pending' ORDER BY created_at ASC");
    res.json(result.rows);
});

// Подтвердить выплату
app.post('/api/admin/withdrawals/complete', async (req, res) => {
    const { id, userId, amount } = req.body;
    await pool.query("UPDATE withdrawals SET status = 'completed' WHERE id = $1", [id]);
    bot.telegram.sendMessage(userId, `✅ Ваша заявка на вывод ${amount} G успешно обработана администратором!`);
    res.json({ success: true });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started` ) );
bot.launch();