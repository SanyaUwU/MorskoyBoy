// =========================================================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ И НАСТРОЙКИ
// =========================================================================
const BOARD_SIZE = 10;
const SHIP_CONFIG = [
    { size: 4, count: 1, name: "Линкор" },
    { size: 3, count: 2, name: "Крейсер" },
    { size: 2, count: 3, name: "Эсминец" },
    { size: 1, count: 4, name: "Катер" }
];

let current_game = null;
let isPlayer1 = false;
let myShips = [];
let boardGrid = [];
let placementMode = true;

// DOM элементы
const authSection = document.getElementById('auth-section');
const gameSection = document.getElementById('game-section');
const myBoardElement = document.getElementById('my-board');
const opponentBoardElement = document.getElementById('opponent-board');
const opponentBoardWrapper = document.getElementById('opponent-board-wrapper');
const boardsContainer = document.getElementById('boards-container');
const placementTools = document.getElementById('placement-tools');
const startBattleButton = document.getElementById('start-battle-button');
const turnIndicator = document.getElementById('turn-indicator');
const playersListCard = document.getElementById('players-list-card');
const activeGameInfo = document.getElementById('active-game-info');
const gameFinishCard = document.getElementById('game-finish-card');

// =========================================================================
// 1. АУТЕНТИФИКАЦИЯ
// =========================================================================

document.getElementById('signin-button').addEventListener('click', () => handleAuth(true));
document.getElementById('signup-button').addEventListener('click', () => handleAuth(false));
document.getElementById('logout-button').addEventListener('click', logout);
document.getElementById('back-to-lobby-button').addEventListener('click', showLobby);

async function handleAuth(isSignIn) {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const authMessage = document.getElementById('auth-message');

    if (!username || !password) {
        authMessage.textContent = "Введите имя и пароль.";
        return;
    }

    try {
        let response;
        if (isSignIn) {
            response = await supabase.auth.signInWithPassword({ email: `${username}@battleship.com`, password });
        } else {
            // При регистрации, используем имя как часть email, чтобы оно было уникальным
            response = await supabase.auth.signUp({ email: `${username}@battleship.com`, password, options: { data: { username: username } } });
        }

        if (response.error) {
            throw response.error;
        }

        authMessage.textContent = 'Успешный вход!';
        initializeUser(response.data.user);

    } catch (error) {
        authMessage.textContent = `Ошибка ${isSignIn ? 'входа' : 'регистрации'}: ${error.message}. Проверьте настройки Supabase.`;
        console.error("Auth Error:", error);
    }
}

function initializeUser(user) {
    if (!user) {
        myUserId = null;
        myUsername = null;
        authSection.style.display = 'block';
        gameSection.style.display = 'none';
        return;
    }

    myUserId = user.id;
    // Используем метаданные или часть email для отображения имени
    myUsername = user.user_metadata?.username || user.email.split('@')[0]; 

    document.getElementById('current-username').textContent = myUsername;
    document.getElementById('current-user-id').textContent = myUserId.substring(0, 8) + '...';
    
    authSection.style.display = 'none';
    gameSection.style.display = 'block';

    checkActiveGame();
    subscribeToPresence();
    subscribeToChallenges();
}

async function logout() {
    await supabase.auth.signOut();
    myUserId = null;
    myUsername = null;
    current_game = null;
    showLobby();
    initializeUser(null);
}

// Загрузка пользователя при старте
supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
        initializeUser(session.user);
    } else {
        initializeUser(null);
    }
});


// =========================================================================
// 2. УПРАВЛЕНИЕ ИГРОКАМИ И ПРИСУТСТВИЕМ (PRESENCE)
// =========================================================================
let presenceChannel = null;

function subscribeToPresence() {
    if (presenceChannel) {
        presenceChannel.unsubscribe();
    }
    
    // Канал для отслеживания онлайн-пользователей
    presenceChannel = supabase.channel('online_players', {
        config: {
            presence: {
                key: myUserId 
            }
        }
    });

    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            const players = Object.keys(state)
                .map(id => state[id][0].username)
                .filter(name => name !== myUsername); // Не показываем себя

            updatePlayersList(players);
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ username: myUsername });
            }
        });
}

function updatePlayersList(players) {
    const list = document.getElementById('online-players-list');
    list.innerHTML = '';
    
    if (players.length === 0) {
        list.innerHTML = '<li>Нет других игроков онлайн.</li>';
        return;
    }

    players.forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        if (current_game === null) {
            const challengeBtn = document.createElement('button');
            challengeBtn.textContent = 'Вызвать на бой ⚔️';
            challengeBtn.className = 'challenge-button';
            challengeBtn.onclick = () => createGame(name);
            li.appendChild(challengeBtn);
        }
        list.appendChild(li);
    });
}


// =========================================================================
// 3. УПРАВЛЕНИЕ ИГРОЙ И REALTIME
// =========================================================================

let gameChannel = null;

async function checkActiveGame() {
    // 1. Проверяем, есть ли незавершенная игра с участием этого игрока
    const { data, error } = await supabase
        .from('games')
        .select('*')
        .or(`player1_id.eq.${myUserId},player2_id.eq.${myUserId}`)
        .not('status', 'in.("finished", "abandoned")')
        .limit(1);

    if (error) {
        console.error("Ошибка проверки активной игры:", error);
        return;
    }

    if (data && data.length > 0) {
        const game = data[0];
        document.getElementById('return-to-game-card').style.display = 'block';
        document.getElementById('return-to-game-button').onclick = () => joinGame(game.id);
    } else {
        document.getElementById('return-to-game-card').style.display = 'none';
    }
}

// Создание игры (вызов)
async function createGame(opponentName) {
    // Шаг 1: Найти ID противника по имени (просто для демонстрации, в реальном проекте лучше передавать ID)
    const { data: opponentData } = await supabase
        .from('users')
        .select('id')
        .eq('raw_user_meta_data->>username', opponentName)
        .limit(1);

    if (!opponentData || opponentData.length === 0) {
        alert("Противник не найден.");
        return;
    }
    const opponentId = opponentData[0].id;
    
    // Шаг 2: Создать игру в статусе 'lobby'
    const { data: game, error: createError } = await supabase
        .from('games')
        .insert({
            player1_id: myUserId,
            player1_name: myUsername, // Используем новую колонку
            player2_id: opponentId,
            player2_name: opponentName, // Используем новую колонку
            status: 'lobby', // Игра создана, но еще не начата
            current_turn: null
        })
        .select()
        .single();

    if (createError) {
        alert("Ошибка при создании игры. Проверьте RLS INSERT или наличие колонок.");
        console.error("Ошибка создания игры:", createError);
        return;
    }

    joinGame(game.id);
}

// Присоединение к игре / Запуск Realtime
async function joinGame(gameId) {
    // Шаг 1: Загрузка данных игры
    const { data: game, error } = await supabase
        .from('games')
        .select('*')
        .eq('id', gameId)
        .limit(1)
        .single();

    if (error) {
        alert("Не удалось найти игру или получить данные (Ошибка RLS SELECT).");
        console.error("Ошибка SELECT при присоединении:", error);
        return;
    }

    current_game = game;
    isPlayer1 = game.player1_id === myUserId;

    // Шаг 2: Настройка интерфейса
    showGameUI();
    
    // Шаг 3: Подписка на Realtime
    if (gameChannel) {
        await supabase.removeChannel(gameChannel);
    }

    gameChannel = supabase.channel(`game_${gameId}`);
    
    gameChannel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
        (payload) => {
            current_game = payload.new;
            updateGameUI(current_game);
        }
    ).subscribe();
    
    // Обновление UI сразу после подписки
    updateGameUI(current_game);
}

function showLobby() {
    boardsContainer.style.display = 'none';
    activeGameInfo.style.display = 'none';
    playersListCard.style.display = 'block';
    gameFinishCard.style.display = 'none';
    
    if (gameChannel) {
        supabase.removeChannel(gameChannel);
    }
    current_game = null;
    // Очистка досок
    myBoardElement.innerHTML = '';
    opponentBoardElement.innerHTML = '';
    
    // Обновление списка игроков (снять блок с кнопок "Вызвать")
    subscribeToPresence();
    checkActiveGame();
}


function showGameUI() {
    // Скрываем лобби
    playersListCard.style.display = 'none';
    document.getElementById('return-to-game-card').style.display = 'none';
    gameFinishCard.style.display = 'none';
    
    // Показываем игру
    activeGameInfo.style.display = 'block';
    boardsContainer.style.display = 'block';
    opponentBoardWrapper.style.display = 'none'; // Поле противника видно только в режиме "battle"
    
    // Установка информации о противнике
    const opponentName = isPlayer1 ? current_game.player2_name : current_game.player1_name;
    document.getElementById('game-id-display').textContent = current_game.id.substring(0, 8) + '...';
    document.getElementById('opponent-name-display').textContent = opponentName;

    // Инициализация досок
    initializeBoard(myBoardElement, true);
    initializeBoard(opponentBoardElement, false);
}

function updateGameUI(game) {
    document.getElementById('game-status-display').textContent = game.status;
    const opponentBoardData = isPlayer1 ? game.player2_board : game.player1_board;
    const myBoardData = isPlayer1 ? game.player1_board : game.player2_board;
    
    const myTurn = game.current_turn === myUserId;
    
    if (game.status === 'lobby' || game.status === 'placement') {
        // Режим расстановки
        placementMode = true;
        
        if (myBoardData === null) {
            // Если свою доску еще не расставили, показываем инструменты
            placementTools.style.display = 'flex';
            document.getElementById('boards-title').textContent = '🛥️ Расстановка кораблей';
            renderShipList(); // Показываем корабли
            
            // Если доска противника уже расставлена
            const opponentReady = opponentBoardData !== null;
            turnIndicator.textContent = opponentReady 
                ? '✅ Соперник расставил корабли. Ждём вас!' 
                : '🟡 Ждём расстановки от вас и соперника.';
        } else {
            // Свою доску расставили, ждем противника
            placementTools.style.display = 'none';
            document.getElementById('boards-title').textContent = 'Ожидание соперника...';
            turnIndicator.textContent = '⏱️ Вы готовы. Ожидаем, пока соперник расставит корабли.';
        }
        
    } else if (game.status === 'battle') {
        // Режим боя
        placementMode = false;
        boardsContainer.style.display = 'flex';
        placementTools.style.display = 'none';
        opponentBoardWrapper.style.display = 'block'; // Показываем поле противника
        document.getElementById('boards-title').textContent = 'Сражение!';

        // Обновление досок с текущими попаданиями/промахами
        updateBoardDisplay(myBoardElement, myBoardData, true);
        updateBoardDisplay(opponentBoardElement, opponentBoardData, false);
        
        // Индикатор хода
        myBoardElement.classList.toggle('turn-highlight', !myTurn);
        opponentBoardElement.classList.toggle('turn-highlight', myTurn);

        if (myTurn) {
            turnIndicator.innerHTML = '🔥 **ВАШ ХОД!** Атакуйте поле противника.';
            opponentBoardElement.classList.add('attack-mode');
        } else {
            turnIndicator.innerHTML = '⏱️ Ход противника. Ожидайте атаки.';
            opponentBoardElement.classList.remove('attack-mode');
        }

    } else if (game.status === 'finished') {
        // Режим завершения игры
        handleGameFinished(game);
    }
}


// =========================================================================
// 4. ЛОГИКА ИГРЫ (ДОСКИ, ВЫСТРЕЛЫ)
// =========================================================================

function initializeBoard(boardElement, isMyBoard) {
    boardElement.innerHTML = ''; // Очистка
    
    // Создаем заголовок (буквы A-J)
    const letters = [' ', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    for (let i = 0; i <= BOARD_SIZE; i++) {
        for (let j = 0; j <= BOARD_SIZE; j++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            
            if (i === 0 && j === 0) {
                // Пустой угол
                cell.className = 'cell coord';
            } else if (i === 0) {
                // Буквы
                cell.textContent = letters[j];
                cell.className = 'cell coord';
            } else if (j === 0) {
                // Цифры
                cell.textContent = i;
                cell.className = 'cell coord';
            } else {
                // Игровые клетки
                cell.dataset.row = i;
                cell.dataset.col = j;
                if (!isMyBoard) {
                    cell.addEventListener('click', handleShot);
                }
            }
            boardElement.appendChild(cell);
        }
    }
}


// Обновление отображения доски (корабли, попадания, промахи)
function updateBoardDisplay(boardElement, boardData, isMyBoard) {
    if (!boardData) return;

    for (let i = 1; i <= BOARD_SIZE; i++) {
        for (let j = 1; j <= BOARD_SIZE; j++) {
            const cell = boardElement.querySelector(`[data-row="${i}"][data-col="${j}"]`);
            if (!cell) continue;

            // Сброс классов
            cell.className = 'cell'; 

            const cellState = boardData[i][j];

            if (isMyBoard) {
                // Моя доска: показывать корабли и попадания по ним
                if (cellState.ship) {
                    // Корабль (виден только на своей доске)
                    const overlay = document.createElement('div');
                    overlay.className = 'ship-overlay';
                    cell.appendChild(overlay);
                }
            }

            if (cellState.hit) {
                cell.classList.add('hit');
                cell.classList.remove('ship-overlay'); // Убрать "непробитый" вид
            } else if (cellState.miss) {
                cell.classList.add('miss');
            }

            // Добавить last-bomb, если это был последний ход
            if (cellState.lastBomb) {
                cell.classList.add('last-bomb');
            } else {
                 cell.classList.remove('last-bomb');
            }
            
            // Если не моя доска и уже был ход, отключить клик
            if (!isMyBoard && (cellState.hit || cellState.miss)) {
                 cell.classList.add('disabled');
            }
        }
    }
}


// Обработка выстрела
async function handleShot(event) {
    if (placementMode || current_game.status !== 'battle' || current_game.current_turn !== myUserId) {
        return; // Не наш ход или не режим боя
    }

    const cell = event.currentTarget;
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);

    if (cell.classList.contains('disabled')) {
        return; // Уже стреляли сюда
    }

    // Определяем, чью доску мы атакуем (игрока 1 или игрока 2)
    const opponentBoardKey = isPlayer1 ? 'player2_board' : 'player1_board';
    const myBoardKey = isPlayer1 ? 'player1_board' : 'player2_board';
    const opponentIdKey = isPlayer1 ? 'player2_id' : 'player1_id';
    
    let opponentBoard = JSON.parse(JSON.stringify(current_game[opponentBoardKey]));
    const targetCell = opponentBoard[row][col];
    
    let isHit = false;
    let isSunk = false;
    let newStatus = 'battle';
    let winnerId = null;

    // --- Логика выстрела ---
    
    // Сброс маркера прошлого хода (lastBomb) у всех клеток на обеих досках
    resetLastBomb(opponentBoard);
    resetLastBomb(current_game[myBoardKey]);
    
    targetCell.lastBomb = true; // Устанавливаем маркер на текущий выстрел

    if (targetCell.ship) {
        // Попадание!
        isHit = true;
        targetCell.hit = true;
        
        // Проверка потопления (упрощенная) - здесь должна быть более сложная логика
        // Мы просто посчитаем, что корабль потоплен, если это был последний выстрел в игре
        
        if (checkWin(opponentBoard)) {
            newStatus = 'finished';
            winnerId = myUserId;
        }

    } else {
        // Промах
        targetCell.miss = true;
    }
    
    // --- Обновление данных ---
    
    const nextTurnId = isHit ? myUserId : current_game[opponentIdKey];
    
    const updateObject = {
        [opponentBoardKey]: opponentBoard, // Обновляем доску противника
        current_turn: nextTurnId, // Передаем ход (или оставляем, если попали)
        status: newStatus,
        winner_id: winnerId,
    };

    const { error } = await supabase
        .from('games')
        .update(updateObject)
        .eq('id', current_game.id);

    if (error) {
        alert("Ошибка при выполнении выстрела. Проверьте RLS UPDATE.");
        console.error("Ошибка выстрела:", error);
    }
}

// Упрощенная функция проверки победы (если все корабли противника поражены)
function checkWin(board) {
    for (let i = 1; i <= BOARD_SIZE; i++) {
        for (let j = 1; j <= BOARD_SIZE; j++) {
            const cell = board[i][j];
            if (cell.ship && !cell.hit) {
                return false; // Есть еще живые части кораблей
            }
        }
    }
    return true; // Все корабли поражены
}

function resetLastBomb(board) {
    for (let i = 1; i <= BOARD_SIZE; i++) {
        for (let j = 1; j <= BOARD_SIZE; j++) {
            if (board[i][j].lastBomb) {
                board[i][j].lastBomb = false;
            }
        }
    }
}


// =========================================================================
// 5. РАССТАНОВКА КОРАБЛЕЙ (PLACEMENT)
// =========================================================================

// Генерация кораблей для списка
function renderShipList() {
    const list = document.getElementById('ship-list');
    list.innerHTML = '';
    myShips = []; // Сброс списка кораблей

    SHIP_CONFIG.forEach(config => {
        for (let i = 0; i < config.count; i++) {
            const shipId = `${config.size}-${i}`;
            const shipWrapper = document.createElement('li');
            shipWrapper.className = 'draggable-ship-wrapper';

            const shipDiv = document.createElement('div');
            shipDiv.className = 'draggable-ship';
            shipDiv.dataset.size = config.size;
            shipDiv.dataset.id = shipId;
            shipDiv.dataset.orientation = 'horizontal';
            shipDiv.draggable = true;
            
            // Кнопка поворота
            const rotateBtn = document.createElement('button');
            rotateBtn.textContent = '🔄';
            rotateBtn.className = 'challenge-button';
            rotateBtn.style.padding = '5px 10px';
            rotateBtn.onclick = () => {
                shipDiv.dataset.orientation = shipDiv.dataset.orientation === 'horizontal' ? 'vertical' : 'horizontal';
                shipDiv.classList.toggle('rotated');
            };

            for (let s = 0; s < config.size; s++) {
                const part = document.createElement('div');
                part.className = 'ship-part';
                shipDiv.appendChild(part);
            }
            
            shipWrapper.appendChild(shipDiv);
            shipWrapper.appendChild(rotateBtn);
            list.appendChild(shipWrapper);
        }
    });

    // Инициализация Drag and Drop
    initDragAndDrop();
    generateInitialBoardGrid();
    startBattleButton.disabled = true;
}


// Генерация пустой сетки доски
function generateInitialBoardGrid() {
    boardGrid = [];
    for (let i = 0; i <= BOARD_SIZE; i++) {
        boardGrid[i] = [];
        for (let j = 0; j <= BOARD_SIZE; j++) {
            boardGrid[i][j] = { ship: false, hit: false, miss: false, lastBomb: false };
        }
    }
}


// Инициализация Drag and Drop для расстановки
function initDragAndDrop() {
    const ships = document.querySelectorAll('.draggable-ship');
    
    ships.forEach(ship => {
        ship.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', ship.dataset.id);
            ship.classList.add('is-dragging');
        });

        ship.addEventListener('dragend', (e) => {
            ship.classList.remove('is-dragging');
        });
    });

    const cells = myBoardElement.querySelectorAll('.cell:not(.coord)');
    cells.forEach(cell => {
        cell.addEventListener('dragover', handleDragOver);
        cell.addEventListener('dragleave', handleDragLeave);
        cell.addEventListener('drop', handleDrop);
        cell.addEventListener('mouseenter', handleMouseEnter);
        cell.addEventListener('mouseleave', handleMouseLeave);
    });
}


// Логика размещения кораблей (упрощено)
// (Необходимо реализовать проверку валидности и обновление myShips)

function handleDrop(e) {
    e.preventDefault();
    
    // Получаем данные о корабле, который перетаскиваем
    const shipId = e.dataTransfer.getData('text/plain');
    const shipElement = document.querySelector(`.draggable-ship[data-id="${shipId}"]`);
    if (!shipElement) return;

    const size = parseInt(shipElement.dataset.size);
    const orientation = shipElement.dataset.orientation;
    const row = parseInt(e.currentTarget.dataset.row);
    const col = parseInt(e.currentTarget.dataset.col);

    // Проверяем валидность размещения (очень упрощенная проверка)
    const isValid = checkPlacementValidity(row, col, size, orientation);

    if (isValid) {
        // Добавляем корабль в сетку и в список
        addShipToGrid(shipId, row, col, size, orientation);
        
        // Скрываем корабль из списка
        shipElement.parentElement.classList.add('ship-placed'); 
        
        // Перерисовываем доску
        updateBoardDisplay(myBoardElement, boardGrid, true);
        
        // Проверяем, все ли корабли расставлены
        checkAllShipsPlaced();

    } else {
        alert("Корабль нельзя разместить в этом месте!");
    }
    
    // Убираем превью
    clearPlacementPreview();
}

function checkPlacementValidity(startRow, startCol, size, orientation) {
    if (orientation === 'horizontal') {
        if (startCol + size > BOARD_SIZE + 1) return false;
        for (let j = startCol; j < startCol + size; j++) {
             // Проверка на занятость и близость к другим кораблям
            if (boardGrid[startRow][j].ship) return false;
        }
    } else {
        if (startRow + size > BOARD_SIZE + 1) return false;
        for (let i = startRow; i < startRow + size; i++) {
             // Проверка на занятость и близость к другим кораблям
            if (boardGrid[i][startCol].ship) return false;
        }
    }
    return true;
}


function addShipToGrid(shipId, startRow, startCol, size, orientation) {
    myShips.push({ id: shipId, size: size, row: startRow, col: startCol, orientation: orientation });
    
    if (orientation === 'horizontal') {
        for (let j = startCol; j < startCol + size; j++) {
            boardGrid[startRow][j].ship = true;
        }
    } else {
        for (let i = startRow; i < startRow + size; i++) {
            boardGrid[i][startCol].ship = true;
        }
    }
}


function checkAllShipsPlaced() {
    const totalShips = SHIP_CONFIG.reduce((sum, cfg) => sum + cfg.count, 0);
    const placedShips = document.querySelectorAll('.draggable-ship:not(.ship-placed)').length;
    
    if (placedShips === 0 && myShips.length === totalShips) {
        startBattleButton.disabled = false;
        alert("Все корабли расставлены! Нажмите 'ГОТОВ!'.");
    }
}

// Функции для превью размещения (mouseenter, leave)
function handleDragOver(e) {
    e.preventDefault();
}

function handleDragLeave(e) {
    clearPlacementPreview();
}

function handleMouseEnter(e) {
    const shipId = document.querySelector('.draggable-ship.is-dragging')?.dataset.id;
    if (!shipId) return;
    
    const shipElement = document.querySelector(`.draggable-ship[data-id="${shipId}"]`);
    const size = parseInt(shipElement.dataset.size);
    const orientation = shipElement.dataset.orientation;
    const row = parseInt(e.currentTarget.dataset.row);
    const col = parseInt(e.currentTarget.dataset.col);
    
    showPlacementPreview(row, col, size, orientation);
}

function handleMouseLeave(e) {
     const shipId = document.querySelector('.draggable-ship.is-dragging')?.dataset.id;
     if (!shipId) clearPlacementPreview();
}

function showPlacementPreview(startRow, startCol, size, orientation) {
    clearPlacementPreview();
    const isValid = checkPlacementValidity(startRow, startCol, size, orientation);
    
    if (orientation === 'horizontal') {
        for (let j = 0; j < size; j++) {
            const cell = myBoardElement.querySelector(`[data-row="${startRow}"][data-col="${startCol + j}"]`);
            if (cell) {
                cell.classList.add(isValid ? 'ship-overlay-valid' : 'ship-overlay-invalid');
            }
        }
    } else {
        for (let i = 0; i < size; i++) {
            const cell = myBoardElement.querySelector(`[data-row="${startRow + i}"][data-col="${startCol}"]`);
            if (cell) {
                cell.classList.add(isValid ? 'ship-overlay-valid' : 'ship-overlay-invalid');
            }
        }
    }
}

function clearPlacementPreview() {
    myBoardElement.querySelectorAll('.ship-overlay-valid, .ship-overlay-invalid').forEach(cell => {
        cell.classList.remove('ship-overlay-valid', 'ship-overlay-invalid');
    });
}


// Обработка кнопки "ГОТОВ! 🚢"
startBattleButton.addEventListener('click', async () => {
    startBattleButton.disabled = true;
    
    // Определяем ключ доски, которую мы обновляем
    const boardKey = isPlayer1 ? 'player1_board' : 'player2_board';
    
    // Шаг 1: Подготовка объекта обновления
    const updateObject = {
        [boardKey]: boardGrid,
        status: 'placement' // Обновляем свой статус расстановки
    };

    // Шаг 2: Проверка, готов ли противник (чтобы решить, кто будет устанавливать статус 'battle')
    const opponentBoardKey = isPlayer1 ? 'player2_board' : 'player1_board';
    const opponentBoardData = current_game[opponentBoardKey];
    
    if (opponentBoardData !== null) {
        // Противник готов! Мы инициируем переход в 'battle'
        
        // *** ГЛАВНОЕ ИСПРАВЛЕНИЕ ХОДА ***
        updateObject.status = 'battle';
        updateObject.current_turn = current_game.player1_id; // Player1 всегда начинает
        console.log("Оба игрока готовы. Устанавливаем статус 'battle' и current_turn:", updateObject.current_turn);
    }
    
    // Шаг 3: Отправка обновления в Supabase
    const { error } = await supabase
        .from('games')
        .update(updateObject)
        .eq('id', current_game.id);

    if (error) {
        alert("Ошибка при сохранении расстановки. Проверьте RLS UPDATE.");
        console.error("Ошибка finishPlacement:", error);
    } else {
        alert("Расстановка сохранена. Ожидаем соперника.");
        placementTools.style.display = 'none'; // Скрываем инструменты
        updateGameUI(Object.assign({}, current_game, updateObject)); // Быстрое обновление UI
    }
});


// =========================================================================
// 6. ЗАВЕРШЕНИЕ ИГРЫ И ВОЗВРАТ В ЛОББИ
// =========================================================================

function handleGameFinished(game) {
    boardsContainer.style.display = 'none';
    activeGameInfo.style.display = 'none';
    gameFinishCard.style.display = 'block';

    const winnerId = game.winner_id;
    const finishMessageElement = document.getElementById('finish-message');

    if (winnerId === myUserId) {
        finishMessageElement.innerHTML = '👑 **ПОБЕДА!** Вы потопили все корабли противника!';
        finishMessageElement.style.color = '#00a84f'; // Зеленый
    } else if (winnerId) {
        finishMessageElement.innerHTML = '💀 **ПОРАЖЕНИЕ.** Соперник оказался сильнее.';
        finishMessageElement.style.color = '#d90000'; // Красный
    } else {
        // Может быть ничья или сдались оба (status: 'abandoned')
        finishMessageElement.innerHTML = 'Игра завершена (Статус: ' + game.status + ')';
        finishMessageElement.style.color = '#0077b6';
    }
    
    // Кнопка "Вернуться в лобби"
    document.getElementById('back-to-lobby-button').onclick = () => {
        // Очищаем текущую игру
        current_game = null; 
        showLobby();
    };
}

// Кнопка "Сдаться и завершить игру"
document.getElementById('end-game-button').addEventListener('click', async () => {
    if (!current_game || !confirm("Вы уверены, что хотите сдаться? Игра будет завершена.")) return;

    const winnerId = isPlayer1 ? current_game.player2_id : current_game.player1_id;

    const { error } = await supabase
        .from('games')
        .update({ status: 'finished', winner_id: winnerId })
        .eq('id', current_game.id);

    if (error) {
        console.error("Ошибка при сдаче игры:", error);
        alert("Не удалось завершить игру. Проверьте RLS UPDATE.");
    }
});
