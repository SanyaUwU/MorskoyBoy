// --- КОНФИГУРАЦИЯ SUPABASE ---
// !!! ЗАМЕНИТЕ ЭТИ ЗНАЧЕНИЯ НА ВАШИ АКТУАЛЬНЫЕ КЛЮЧИ !!!
const SUPABASE_URL = 'https://snsvzagvrzdoxaepvivt.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNuc3Z6YWd2cnpkb3hhZXB2aXZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2Mjg0NDIsImV4cCI6MjA3OTIwNDQ0Mn0.q5OATaGULNHzWmT7ccDlFPNITh7091kyxFFh8LL7ZAY';
// !!! НЕ ЗАБУДЬТЕ ЗАМЕНИТЬ !!!

// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ---
let supabase = null;
let presenceChannel = null;
let gameChannel = null;

// Игровая логика будет использовать эти данные
let currentUserData = { id: null, username: null, gameId: null };
let currentGameState = null;

// --- ИНИЦИАЛИЗАЦИЯ И ОБРАБОТКА ---
try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    document.getElementById('auth-message').textContent = 'Библиотека Supabase загружена.';
    // Запускаем проверку статуса, которая находится в game.js
    window.addEventListener('load', () => checkAuthStatus());
} catch (e) {
    console.error("Ошибка инициализации Supabase:", e);
    document.getElementById('auth-message').textContent = 'Критическая ошибка: Не удалось инициализировать Supabase.';
    document.getElementById('auth-message').className = 'error-message';
}

// --- ФУНКЦИИ АУТЕНТИФИКАЦИИ ---

async function handleAuth(type) {
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    
    if (!username || !password) return displayAuthMessage('Введите имя и пароль.', false);

    const email = username.toLowerCase() + '@battleship.local';
    
    let authResult;
    if (type === 'signin') {
        authResult = await supabase.auth.signInWithPassword({ email, password });
    } else {
        authResult = await supabase.auth.signUp({ 
            email, 
            password,
            options: { data: { username: username } }
        });
    }
    
    const { data, error: authError } = authResult;

    if (authError) {
        let msg = authError.message.includes('already registered') ? 'Ошибка: Этот ник уже занят.' : `Ошибка ${type}. Проверьте настройки Supabase.`;
        displayAuthMessage(msg, false);
        return;
    }
    
    const user = data.user;
    if (!user) {
        displayAuthMessage('Регистрация прошла, но не удалось войти. Попробуйте Войти.', false);
        return;
    }
    
    if (type === 'signup') {
        const { error: profileError } = await supabase
            .from('profiles')
            .upsert({ id: user.id, username: username });
        if (profileError) {
            displayAuthMessage('Ошибка сохранения профиля. Проверьте RLS на таблице PROFILES.', false);
            return;
        }
    }

    currentUserData.id = user.id;
    currentUserData.username = username;
    usernameInput.value = '';
    passwordInput.value = '';
    
    setupPresence(user.id, username);
    updateUI(user, username);
    displayAuthMessage(`Добро пожаловать, ${username}! Вход выполнен.`, true);
    checkAndResumeGame(false); 
}

async function checkAuthStatus() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        // Загружаем имя пользователя из профиля
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('username')
            .eq('id', user.id)
            .single();

        if (profile) {
            currentUserData.id = user.id;
            currentUserData.username = profile.username;
            updateUI(user, profile.username);
            setupPresence(user.id, profile.username);
            checkAndResumeGame(false);
        } else {
            // Если профиль не найден, возможно, ошибка RLS или регистрация не завершена
            await supabase.auth.signOut();
            displayAuthMessage('Не удалось загрузить профиль. Выполните вход.', false);
        }
    } else {
        document.getElementById('auth-section').style.display = 'block';
        document.getElementById('game-section').style.display = 'none';
        document.getElementById('auth-message').textContent = 'Пожалуйста, войдите или зарегистрируйтесь.';
    }
}

async function cleanUpSession() {
    if (gameChannel) {
        supabase.removeChannel(gameChannel);
        gameChannel = null;
    }
    if (presenceChannel) {
        try {
            await presenceChannel.untrack();
            supabase.removeChannel(presenceChannel);
        } catch (e) { /* ignore */ }
        presenceChannel = null;
    }
    // Сброс UI и данных (будет сделано в game.js)
    window.resetGameUI(); 
    currentUserData.gameId = null;
}


// --- ФУНКЦИИ ПРИСУТСТВИЯ (LOBBY) ---

function setupPresence(userId, username) {
    if (presenceChannel) supabase.removeChannel(presenceChannel);

    presenceChannel = supabase.channel('online-players', {
        config: { presence: { key: userId } }
    });

    presenceChannel.on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        displayOnlinePlayers(state, userId);
    });
    
    presenceChannel.on('broadcast', { event: 'challenge' }, (payload) => {
        handleIncomingChallenge(payload.payload);
    });

    presenceChannel
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                const activeGame = await getActiveGame();
                const gameId = activeGame ? activeGame.id : null;
                await presenceChannel.track({ user_id: userId, username: username, gameId: gameId }); 
            }
        });
}

async function sendChallenge(opponentId, opponentUsername) {
    const { data: game, error } = await supabase
        .from('games')
        .insert([{ 
            player1_id: currentUserData.id, 
            player1_name: currentUserData.username,
            player2_id: opponentId, 
            player2_name: opponentUsername,
            status: 'placement' 
        }])
        .select()
        .single();
    
    if (error) {
        alert('Ошибка при создании игры. Проверьте RLS INSERT: ' + error.message);
        return;
    }
    
    // Обновляем статус присутствия и запускаем игру
    await presenceChannel.track({ user_id: currentUserData.id, username: currentUserData.username, gameId: game.id }); 
    window.startGame(game, opponentUsername); 

    // Отправляем уведомление противнику
    await presenceChannel.send({
        type: 'broadcast',
        event: 'challenge',
        payload: { 
            gameId: game.id, 
            challengerId: currentUserData.id, 
            challengerName: currentUserData.username 
        }
    });
}

async function joinGame(gameId, challengerName) {
    const { data: game, error } = await supabase
        .from('games')
        .select()
        .eq('id', gameId)
        .single();

    if (error || !game) {
        alert('Ошибка: Не удалось найти игру. ' + (error ? error.message : ''));
        return;
    }
    
    // Обновляем статус присутствия и запускаем игру
    await presenceChannel.track({ user_id: currentUserData.id, username: currentUserData.username, gameId: game.id });
    window.startGame(game, challengerName);
}

// --- ФУНКЦИИ REALTIME ИГРЫ ---

function setupGameChannel(gameId) {
    if (gameChannel) supabase.removeChannel(gameChannel);

    gameChannel = supabase.channel(`game-${gameId}`);
    
    gameChannel.on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'games', 
        filter: `id=eq.${gameId}` 
    }, (payload) => {
        console.log('Realtime Game Update:', payload.new);
        window.handleGameUpdate(payload.new);
    });
    
    gameChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            // Если игрок подключился, отправляем начальное состояние
            gameChannel.send({ type: 'broadcast', event: 'game_ready' });
        }
    });
}


async function getActiveGame() {
    const { data, error } = await supabase
        .from('games')
        .select('*')
        .or(`player1_id.eq.${currentUserData.id},player2_id.eq.${currentUserData.id}`)
        .not('status', 'eq', 'finished')
        .limit(1);

    if (error) {
        console.error('Ошибка проверки активной игры (RLS SELECT):', error);
        return null;
    }
    return data.length > 0 ? data[0] : null;
}

// --- ЭКСПОРТ ДЛЯ GAME.JS (ПЕРЕМЕННЫЕ) ---
window.supabase = supabase;
window.currentUserData = currentUserData;
window.currentGameState = currentGameState;
window.presenceChannel = presenceChannel;
// --- ЭКСПОРТ ДЛЯ GAME.JS (ФУНКЦИИ) ---
window.handleAuth = handleAuth;
window.checkAuthStatus = checkAuthStatus;
window.cleanUpSession = cleanUpSession;
window.sendChallenge = sendChallenge;
window.joinGame = joinGame;
window.setupGameChannel = setupGameChannel;
window.getActiveGame = getActiveGame;

// Функции-обертки для DOM, используемые в game.js
function displayAuthMessage(message, isSuccess = true) {
    const authMessage = document.getElementById('auth-message');
    authMessage.textContent = message;
    authMessage.className = isSuccess ? 'success-message' : 'error-message';
    setTimeout(() => {
        authMessage.textContent = '';
        authMessage.className = '';
    }, 5000);
}

function updateUI(user, username) {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('game-section').style.display = 'block';
    document.getElementById('current-username').textContent = username;
    document.getElementById('current-user-id').textContent = user.id.substring(0, 8) + '...';
    document.getElementById('players-list-card').style.display = 'block';
}

window.displayAuthMessage = displayAuthMessage;
window.updateUI = updateUI;
window.setupPresence = setupPresence;
