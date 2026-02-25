const { Telegraf } = require('telegraf');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEB_APP_URL = process.env.WEB_APP_URL; 
const ADMIN_ID = parseInt(process.env.ADMIN_ID); // ID админа (числом)
const MONGODB_URI = process.env.MONGODB_URI; // Ссылка на базу

// --- ПОДКЛЮЧЕНИЕ К MONGODB ---
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB error:', err));

// Схема пользователя в базе
const UserSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true },
    username: String,
    balance: { type: Number, default: 0 },
    registrationDate: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// --- БОТ И SERVER ---
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.static('public'));
app.use(bodyParser.json());

// Команда /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || 'Anon';

    // Создаем пользователя в базе, если нет
    try {
        let user = await User.findOne({ telegramId: userId });
        if (!user) {
            user = new User({ telegramId: userId, username: username });
            await user.save();
        }
        
        ctx.reply('💎 Добро пожаловать в Project Evo Earner! Жми кнопку ниже.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🚀 Запустить приложение", web_app: { url: WEB_APP_URL } }]
                ]
            }
        });
    } catch (e) {
        console.error(e);
    }
});

// API: Получить данные юзера + проверка на админа
app.get('/api/user/:id', async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        let user = await User.findOne({ telegramId: userId });
        
        if (!user) return res.json({ error: 'User not found' });

        const isAdmin = (userId === ADMIN_ID);
        // Минималка: 10 для админа, 1000 для смертных
        const minWithdraw = isAdmin ? 10 : 1000;

        res.json({ 
            balance: parseFloat(user.balance.toFixed(1)), 
            isAdmin, 
            minWithdraw 
        });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// API: Награда (1.0 - 1.5 Gold)
app.post('/api/reward', async (req, res) => {
    try {
        const { userId } = req.body;
        const user = await User.findOne({ telegramId: userId });
        if (!user) return res.status(404).json({ error: 'No user' });

        // Генерация случайного числа от 1.0 до 1.5
        const reward = Math.floor((Math.random() * 0.5 + 1) * 10) / 10;
        
        user.balance += reward;
        await user.save();

        res.json({ success: true, reward, newBalance: parseFloat(user.balance.toFixed(1)) });
    } catch (e) {
        res.status(500).json({ error: 'Error' });
    }
});

// API: Вывод средств
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, gameId } = req.body;
        const user = await User.findOne({ telegramId: userId });

        if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });

        const isAdmin = (user.telegramId === ADMIN_ID);
        const minWithdraw = isAdmin ? 10 : 1000;

        if (user.balance < minWithdraw) {
            return res.json({ success: false, message: `Минимум для вывода: ${minWithdraw} G` });
        }

        const amount = parseFloat(user.balance.toFixed(1));
        
        // Списываем
        user.balance = 0;
        await user.save();

        // Уведомление в Telegram админу
        bot.telegram.sendMessage(ADMIN_ID, 
            `💸 <b>ЗАЯВКА НА ВЫВОД</b>\n\n👤 Игрок: @${user.username}\n🆔 Game ID: <code>${gameId}</code>\n💰 Сумма: <b>${amount} G</b>`, 
            { parse_mode: 'HTML' }
        );

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'Ошибка сервера' });
    }
});

// API: Админ-панель (статистика)
app.get('/api/admin/stats', async (req, res) => {
    const usersCount = await User.countDocuments();
    // Сумма всех балансов пользователей (долг проекта)
    const totalGold = await User.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]);
    
    res.json({
        users: usersCount,
        debt: totalGold[0] ? totalGold[0].total.toFixed(1) : 0
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));