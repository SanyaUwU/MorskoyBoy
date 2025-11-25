// Переменные, которые используются в game.js и инициализируются в supabase.js
// window.supabase, window.currentUserData, window.currentGameState
// window.updateUI, window.displayAuthMessage, window.cleanUpSession, etc.

const BOARD_SIZE = 10;
const SHIP_CONFIG = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1]; // Классический флот: 1-4, 2-3, 3-2, 4-1
const TOTAL_SHIP_CELLS = SHIP_CONFIG.reduce((sum, size) => sum + size, 0); // 20 клеток

// --- ГЛОБАЛЬНЫЕ ИГРОВЫЕ ПЕРЕМЕННЫЕ ---
let myShips = []; 
let isMyTurn = false;
let currentDragShip = null; 
let currentDragCell = null; 
let lastShotCoord = null; 

// --- КЭШИРОВАНИЕ ЭЛЕМЕНТОВ DOM ---
let myBoardElement;
let opponentBoardElement;
let startBattleButton;
let randomPlacementButton;
let endGameButton;
let returnToGameButton;
let placementTools;
let shipList;

window.addEventListener('load', () => {
    // Назначаем DOM-элементы после загрузки страницы
    myBoardElement = document.getElementById('my-board');
    opponentBoardElement = document.getElementById('opponent-board');
    startBattleButton = document.getElementById('start-battle-button');
    randomPlacementButton = document.getElementById('random-placement-button');
    endGameButton = document.getElementById('end-game-button');
    returnToGameButton = document.getElementById('return-to-game-button');
    placementTools = document.getElementById('placement-tools');
    shipList = document.getElementById('ship-list');
    
    // Привязка событий аутентификации
    document.getElementById('signin-button').addEventListener('click', () => window.handleAuth('signin'));
    document.getElementById('signup-button').addEventListener('click', () => window.handleAuth('signup'));

    // Привязка событий игры
    randomPlacementButton.addEventListener('click', placeShipsRandomly);
    returnToGameButton.addEventListener('click', () => checkAndResumeGame(true));
    endGameButton.addEventListener('click', endGameAndLobby);
    document.getElementById('logout-button').addEventListener('click', async () => {
        await window.supabase.auth.signOut();
        await window.cleanUpSession();
        document.getElementById('auth-section').style.display = 'block';
        document.getElementById('game-section').style.display = 'none';
        window.displayAuthMessage('Вы вышли из системы.', true);
    });

    // Привязка событий Drag & Drop
    shipList.addEventListener('mousedown', handleDragStart);
    myBoardElement.addEventListener('mouseover', handleDragOverBoard);
    myBoardElement.addEventListener('mouseout', handleDragOutBoard);
    myBoardElement.addEventListener('contextmenu', (e) => { e.preventDefault(); handleRotate(e); });
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('mousemove', handleDragMove);

    // Экспорт функций для использования в supabase.js
    window.startGame = startGame;
    window.handleGameUpdate = handleGameUpdate;
    window.checkAndResumeGame = checkAndResumeGame;
    window.displayOnlinePlayers = displayOnlinePlayers;
    window.handleIncomingChallenge = handleIncomingChallenge;
    window.resetGameUI = resetGameUI;
});

// --- СБРОС UI ---
function resetGameUI() {
    const boardsContainer = document.getElementById('boards-container');
    const activeGameInfo = document.getElementById('active-game-info');
    const returnToGameCard = document.getElementById('return-to-game-card');
    
    boardsContainer.style.display = 'none';
    activeGameInfo.style.display = 'none';
    placementTools.style.display = 'none';
    returnToGameCard.style.display = 'none'; 
    document.getElementById('players-list-card').style.display = 'block';
    
    createBoard(myBoardElement); // Очистка
    createBoard(opponentBoardElement); // Очистка
    myShips = [];
    lastShotCoord = null;
    endGameButton.disabled = false;
}

// --- ЛОГИКА ЛОББИ ---

function displayOnlinePlayers(state, currentUserId) {
    const onlinePlayersList = document.getElementById('online-players-list');
    onlinePlayersList.innerHTML = '';
    
    // Преобразуем объект присутствия в массив
    const players = Object.keys(state).map(userId => ({
        id: userId,
        username: state[userId][0].username,
        gameId: state[userId][0].gameId // Добавлено для статуса
    }));

    players.forEach(player => {
        if (player.id === currentUserId) return; // Не показываем себя

        const listItem = document.createElement('li');
        listItem.textContent = player.username;
        listItem.style.padding = '10px 0';
        listItem.style.borderBottom = '1px solid #333';
        listItem.style.display = 'flex';
        listItem.style.justifyContent = 'space-between';
        listItem.style.alignItems = 'center';
        
        const statusSpan = document.createElement('span');
        const challengeButton = document.createElement('button');
        challengeButton.className = 'challenge-button';
        challengeButton.style.width = '120px';
        challengeButton.style.padding = '5px 10px';
        challengeButton.style.fontSize = '14px';

        if (player.gameId) {
            statusSpan.textContent = '(В игре)';
            statusSpan.style.color = 'var(--hit-color)';
            challengeButton.textContent = 'Занят';
            challengeButton.disabled = true;
        } else {
            statusSpan.textContent = '(Готов)';
            statusSpan.style.color = 'var(--last-hit-color)';
            challengeButton.textContent = 'Бросить вызов';
            challengeButton.onclick = () => window.sendChallenge(player.id, player.username);
        }
        
        listItem.appendChild(statusSpan);
        listItem.appendChild(challengeButton);
        onlinePlayersList.appendChild(listItem);
    });
}

function handleIncomingChallenge(payload) {
    if (window.currentUserData.gameId) return; // Игнорируем, если уже в игре

    if (confirm(`Игрок ${payload.challengerName} вызывает вас на морской бой! Принять?`)) {
        window.joinGame(payload.gameId, payload.challengerName);
    } else {
        // Опционально: отправить сообщение о "отказе" обратно
    }
}

async function checkAndResumeGame(forceResume) {
    const activeGame = await window.getActiveGame();
    const returnToGameCard = document.getElementById('return-to-game-card');
    
    if (activeGame) {
        // Если найдена активная игра
        const opponentName = activeGame.player1_id === window.currentUserData.id ? activeGame.player2_name : activeGame.player1_name;
        
        if (forceResume) {
            window.startGame(activeGame, opponentName);
        } else {
            // Показываем кнопку "Вернуться" в лобби
            returnToGameCard.style.display = 'block';
            document.getElementById('players-list-card').style.display = 'none';
        }
    } else {
        returnToGameCard.style.display = 'none';
        document.getElementById('players-list-card').style.display = 'block';
    }
}

// --- ЛОГИКА ИГРЫ И УПРАВЛЕНИЕ UI ---

function startGame(gameData, opponentUsername) {
    window.currentGameState = gameData;
    window.currentUserData.gameId = gameData.id;
    
    document.getElementById('active-game-info').style.display = 'block';
    document.getElementById('boards-container').style.display = 'block';
    document.getElementById('game-id-display').textContent = gameData.id.substring(0, 8) + '...';
    document.getElementById('opponent-name-display').textContent = opponentUsername;
    document.getElementById('players-list-card').style.display = 'none';
    document.getElementById('return-to-game-card').style.display = 'none';

    createBoard(myBoardElement);
    createBoard(opponentBoardElement);

    const myBoard = gameData.player1_id === window.currentUserData.id ? gameData.player1_board : gameData.player2_board;
    
    if (myBoard && myBoard.ships && myBoard.ships.length === TOTAL_SHIP_CELLS) {
        placementTools.style.display = 'none';
    } else {
        generateShipsForPlacement();
        placementTools.style.display = 'flex';
    }
    
    startBattleButton.onclick = () => finishPlacement(gameData.id);

    handleGameUpdate(gameData);
    
    window.setupGameChannel(gameData.id);
}

async function endGameAndLobby() {
    if (!window.currentUserData.gameId) return;
    if (!confirm('Вы уверены, что хотите завершить игру и вернуться в лобби? Игра будет помечена как завершенная.')) return;
    
    // Определяем противника как победителя, так как текущий игрок сдался
    const opponentId = window.currentGameState.player1_id === window.currentUserData.id 
                       ? window.currentGameState.player2_id 
                       : window.currentGameState.player1_id;

    const { error } = await window.supabase
        .from('games')
        .update({ status: 'finished', winner_id: opponentId }) 
        .eq('id', window.currentUserData.gameId);

    if (error) {
        console.error('Ошибка завершения игры:', error);
        alert('Ошибка сервера при завершении игры. Проверьте RLS. КОД ОШИБКИ: ' + error.message);
        return;
    }
    
    alert('Игра завершена (вы сдались). Вы возвращаетесь в лобби.');
    await window.cleanUpSession();
    window.setupPresence(window.currentUserData.id, window.currentUserData.username);
}

async function finishPlacement(gameId) {
    if (!checkPlacementComplete()) return alert('Расстановка не завершена!');
    
    startBattleButton.disabled = true;
    placementTools.style.display = 'none'; // Скрываем инструменты

    // Сохраняем только координаты занятых клеток для Supabase
    const shipCoords = myShips.reduce((acc, ship) => acc.concat(ship.coords), []);
    
    const fieldToUpdate = window.currentGameState.player1_id === window.currentUserData.id ? 'player1_board' : 'player2_board';
    
    const boardData = {
        ships: shipCoords, // Массив координат
        hits: [],
        misses: []
    };

    const updateObject = {};
    updateObject[fieldToUpdate] = boardData;
    
    const opponentBoard = window.currentGameState.player1_id === window.currentUserData.id 
                          ? window.currentGameState.player2_board 
                          : window.currentGameState.player1_board;

    // Условие перехода в бой (только если противник уже расставил)
    if (opponentBoard && opponentBoard.ships && opponentBoard.ships.length === TOTAL_SHIP_CELLS) { 
        updateObject['status'] = 'in_progress'; 
    }

    const { error } = await window.supabase
        .from('games')
        .update(updateObject)
        .eq('id', gameId);

    if (error) {
        console.error('Ошибка сохранения расстановки (Supabase Error):', error);
        alert('Ошибка сохранения кораблей. Возможно, проблема с RLS UPDATE. КОД ОШИБКИ: ' + error.message);
        // Возвращаем UI в исходное состояние при ошибке
        startBattleButton.disabled = false;
        placementTools.style.display = 'flex';
        return;
    }
    
    console.log('Обновление успешно отправлено. Ожидаем Realtime.');
}

function handleGameUpdate(gameData) {
    window.currentGameState = gameData;
    
    const myBoard = gameData.player1_id === window.currentUserData.id ? gameData.player1_board : gameData.player2_board;
    const opponentBoard = gameData.player1_id === window.currentUserData.id ? gameData.player2_board : gameData.player1_board;
    const opponentBoardWrapper = document.getElementById('opponent-board-wrapper');
    const myBoardWrapper = document.getElementById('my-board-wrapper');

    // Определяем последний выстрел по мне
    const allShots = [...(myBoard?.hits || []), ...(myBoard?.misses || [])];
    lastShotCoord = allShots[allShots.length - 1]; 
    
    
    // --- УСЛОВИЕ ПОБЕДЫ/ПОРАЖЕНИЯ ---
    const isGameOver = checkWinCondition(opponentBoard);
    if (isGameOver && gameData.status !== 'finished') {
        window.currentGameState.status = 'finished';
        const winnerId = window.currentUserData.id;
        window.supabase.from('games').update({ status: 'finished', winner_id: winnerId }).eq('id', window.currentGameState.id);
        return; 
    } else if (gameData.status === 'finished') {
        document.getElementById('game-status-display').textContent = gameData.winner_id === window.currentUserData.id ? `🎉 ВЫ ПОБЕДИЛИ!` : `😭 Вы проиграли.`;
        document.getElementById('turn-indicator').textContent = 'Игра окончена.';
        endGameButton.disabled = true;
        // Отображаем финальное состояние
        renderMyBoard(myBoard);
        renderOpponentBoard(opponentBoard);
        myBoardWrapper.classList.remove('turn-highlight');
        opponentBoardWrapper.classList.remove('turn-highlight');
        return;
    }
    
    // --- Управление Статусами ---
    
    if (gameData.status === 'placement') {
        const myShipsPlaced = myBoard && myBoard.ships && myBoard.ships.length === TOTAL_SHIP_CELLS;
        
        document.getElementById('boards-title').textContent = '🛥️ Расстановка кораблей';
        opponentBoardWrapper.style.display = 'none';

        if (myShipsPlaced) {
            document.getElementById('game-status-display').textContent = 'Ожидание, пока соперник расставит корабли...';
            placementTools.style.display = 'none';
        } else {
            document.getElementById('game-status-display').textContent = 'Расставляйте свои корабли.';
            placementTools.style.display = 'flex';
        }
        document.getElementById('turn-indicator').textContent = ''; 
        renderMyBoard(myBoard); // Отображаем расставленные корабли
        return; 
    }
    
    // 2. Если статус 'in_progress'
    if (gameData.status === 'in_progress') {
        document.getElementById('boards-title').textContent = '⚔️ Поле Боя';
        placementTools.style.display = 'none';
        opponentBoardWrapper.style.display = 'block'; 

        isMyTurn = gameData.current_turn === window.currentUserData.id;
        document.getElementById('game-status-display').textContent = 'Идет бой!';
        
        myBoardWrapper.classList.toggle('turn-highlight', !isMyTurn);
        opponentBoardWrapper.classList.toggle('turn-highlight', isMyTurn);
        document.getElementById('turn-indicator').innerHTML = isMyTurn 
            ? '<span style="color:var(--last-hit-color);">✅ ВАШ ХОД! Атакуйте!</span>' 
            : '<span style="color:var(--hit-color);">⏳ ХОД ПРОТИВНИКА. Ожидайте...</span>';
    }

    renderMyBoard(myBoard);
    renderOpponentBoard(opponentBoard);
}

// --- РЕНДЕРИНГ ДОСОК В РЕЖИМЕ БОЯ ---

function createBoard(container) {
    container.innerHTML = '';
    const columns = [' ', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    container.classList.remove('attack-mode', 'disabled');

    for (let r = 0; r <= BOARD_SIZE; r++) {
        for (let c = 0; c <= BOARD_SIZE; c++) {
            const cell = document.createElement('div');
            
            if (r === 0 || c === 0) {
                cell.className = 'coord';
                cell.textContent = r === 0 ? columns[c] : r;
            } else {
                cell.className = 'cell';
                cell.dataset.row = r;
                cell.dataset.col = c;
                cell.dataset.coord = `${r}-${c}`;
            }
            container.appendChild(cell);
        }
    }
}

function renderMyBoard(myBoardData) {
    const board = myBoardElement;
    board.classList.add('disabled'); // Свое поле не кликабельно

    // Очищаем оверлеи D&D
    board.querySelectorAll('.ship-overlay').forEach(el => el.remove());

    for (const cell of board.querySelectorAll('.cell')) {
        const coord = cell.dataset.coord;
        cell.classList.remove('hit', 'miss', 'last-bomb');

        // Отображаем корабли (только свои)
        if (myBoardData && myBoardData.ships && myBoardData.ships.includes(coord)) {
            // Создаем оверлей, чтобы корабль отображался постоянно
            if (!cell.querySelector('.ship-overlay')) {
               const overlay = document.createElement('div');
               overlay.className = 'ship-overlay';
               cell.appendChild(overlay);
            }
        } else {
            cell.querySelector('.ship-overlay')?.remove();
        }
        
        // ХИТЫ/ПРОМАХИ, полученные от противника
        if (myBoardData && myBoardData.hits && myBoardData.hits.includes(coord)) {
            cell.classList.add('hit');
        } else if (myBoardData && myBoardData.misses && myBoardData.misses.includes(coord)) {
            cell.classList.add('miss');
        }
        
        // Выделение последнего удара противника по мне
        if (coord === lastShotCoord) {
            cell.classList.add('last-bomb');
        }
    }
}

function renderOpponentBoard(opponentBoardData) {
    const board = opponentBoardElement;
    
    // Включаем/выключаем режим атаки и курсор
    board.classList.toggle('attack-mode', isMyTurn && window.currentGameState.status === 'in_progress');
    board.classList.toggle('disabled', !isMyTurn || window.currentGameState.status !== 'in_progress');

    for (const cell of board.querySelectorAll('.cell')) {
        const coord = cell.dataset.coord;
        cell.classList.remove('hit', 'miss', 'last-bomb');
        cell.removeEventListener('click', fireShot);
        
        if (isMyTurn && window.currentGameState.status === 'in_progress') {
            // Добавляем обработчик, только если это наш ход и клетка не атакована
            if (!(opponentBoardData?.hits?.includes(coord) || opponentBoardData?.misses?.includes(coord))) {
                cell.addEventListener('click', fireShot);
            }
        }

        // ХИТЫ/ПРОМАХИ, нанесенные мной
        if (opponentBoardData && opponentBoardData.hits && opponentBoardData.hits.includes(coord)) {
            cell.classList.add('hit');
        } else if (opponentBoardData && opponentBoardData.misses && opponentBoardData.misses.includes(coord)) {
            cell.classList.add('miss');
        }
        
        // Выделение последнего удара, нанесенного мной (самый свежий hit или miss на поле противника)
        const opponentShots = [...(opponentBoardData?.hits || []), ...(opponentBoardData?.misses || [])];
        const myLastShot = opponentShots[opponentShots.length - 1];
        
        if (coord === myLastShot) {
            cell.classList.add('last-bomb');
        }
    }
}

async function fireShot(e) {
    if (!isMyTurn || window.currentGameState.status !== 'in_progress') return;
    
    const cell = e.target.closest('.cell');
    if (!cell || !cell.dataset.coord) return;
    
    const targetCoord = cell.dataset.coord;

    // Блокируем поле для предотвращения двойного клика
    opponentBoardElement.classList.add('disabled'); 

    const targetPlayerField = window.currentGameState.player1_id === window.currentUserData.id ? 'player2_board' : 'player1_board';
    const targetBoard = window.currentGameState.player1_id === window.currentUserData.id ? window.currentGameState.player2_board : window.currentGameState.player1_board;
    
    const opponentId = window.currentGameState.player1_id === window.currentUserData.id ? window.currentGameState.player2_id : window.currentGameState.player1_id;
    
    let isHit = targetBoard.ships.includes(targetCoord);
    
    const updatedHits = [...(targetBoard.hits || [])];
    const updatedMisses = [...(targetBoard.misses || [])];

    if (isHit) {
        updatedHits.push(targetCoord);
    } else {
        updatedMisses.push(targetCoord);
    }
    
    const updatedBoardData = { 
        ships: targetBoard.ships, 
        hits: updatedHits, 
        misses: updatedMisses 
    };
    
    const updateObject = {};
    updateObject[targetPlayerField] = updatedBoardData;
    
    // Передача хода, если это промах
    updateObject.current_turn = isHit ? window.currentUserData.id : opponentId; 

    const { error } = await window.supabase
        .from('games')
        .update(updateObject)
        .eq('id', window.currentUserData.gameId);

    if (error) {
        console.error('Ошибка при выстреле:', error);
        alert('Ошибка сервера при выстреле. Проверьте RLS UPDATE.');
        opponentBoardElement.classList.remove('disabled');
    }
    // Realtime обработает обновление
}

function checkWinCondition(opponentBoard) {
    if (!opponentBoard || !opponentBoard.ships) return false;
    
    const totalShips = opponentBoard.ships.length;
    const totalHits = opponentBoard.hits ? opponentBoard.hits.length : 0;
    
    return totalHits >= totalShips && totalShips === TOTAL_SHIP_CELLS;
}


// --- DRAG & DROP FUNCTIONS ---

function generateShipsForPlacement() {
    myShips = [];
    shipList.innerHTML = '';
    
    SHIP_CONFIG.forEach((size, index) => {
        const shipId = `ship-${index}`;
        const ship = {
            id: shipId,
            size: size,
            orientation: 'horizontal',
            placed: false,
            startCoord: null, // r-c
            coords: [] // Все клетки, которые занимает корабль
        };
        myShips.push(ship);
        
        const listItem = document.createElement('li');
        listItem.className = 'draggable-ship-wrapper';
        
        const shipElement = document.createElement('div');
        shipElement.className = 'draggable-ship';
        shipElement.setAttribute('draggable', 'true');
        shipElement.dataset.shipId = shipId;
        shipElement.dataset.size = size;
        shipElement.dataset.orientation = 'horizontal';
        
        for (let i = 0; i < size; i++) {
            const part = document.createElement('div');
            part.className = 'ship-part';
            shipElement.appendChild(part);
        }
        
        const rotateButton = document.createElement('button');
        rotateButton.textContent = '⟳';
        rotateButton.style.padding = '5px 10px';
        rotateButton.style.marginLeft = '10px';
        rotateButton.style.background = '#444466';
        rotateButton.onclick = (e) => {
            e.stopPropagation();
            rotateShipInList(shipId);
        };
        
        listItem.appendChild(shipElement);
        listItem.appendChild(rotateButton);
        shipList.appendChild(listItem);
    });
}

function rotateShipInList(shipId) {
    const shipData = myShips.find(s => s.id === shipId);
    if (!shipData || shipData.placed) return;
    
    shipData.orientation = shipData.orientation === 'horizontal' ? 'vertical' : 'horizontal';
    
    const shipElement = shipList.querySelector(`[data-ship-id="${shipId}"]`);
    shipElement.dataset.orientation = shipData.orientation;
    shipElement.classList.toggle('rotated', shipData.orientation === 'vertical');
}

function handleDragStart(e) {
    if (window.currentGameState.status !== 'placement') return;
    
    let target = e.target.closest('.draggable-ship');
    if (!target) return;
    
    const shipId = target.dataset.shipId;
    currentDragShip = myShips.find(s => s.id === shipId);
    if (!currentDragShip || currentDragShip.placed) return;
    
    target.classList.add('is-dragging');
    document.body.style.cursor = 'grabbing';
}

function handleDragMove(e) {
    if (!currentDragShip) return;

    const boardRect = myBoardElement.getBoundingClientRect();
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Если курсор над доской
    if (mouseX > boardRect.left && mouseX < boardRect.right && 
        mouseY > boardRect.top && mouseY < boardRect.bottom) 
    {
        const cell = e.target.closest('.cell');
        if (cell && cell.dataset.coord) {
            handleDragOverCell(cell);
        } else {
            // Если курсор над доской, но не над клеткой (например, над координатами)
            handleDragOutBoard();
        }
    } else {
        handleDragOutBoard();
    }
}

function handleDragOverBoard(e) {
    if (!currentDragShip) return;
    const cell = e.target.closest('.cell');
    if (cell && cell.dataset.coord) {
        handleDragOverCell(cell);
    }
}

function handleDragOutBoard() {
    if (currentDragCell) {
        clearShipPreview();
        currentDragCell = null;
    }
}

function handleDragOverCell(cell) {
    if (!currentDragShip || cell === currentDragCell) return;
    
    currentDragCell = cell;
    const r = parseInt(cell.dataset.row);
    const c = parseInt(cell.dataset.col);

    clearShipPreview();
    
    const { isValid, coords } = getShipCoordinates(r, c, currentDragShip);
    
    if (isValid) {
        coords.forEach(coord => {
            const targetCell = myBoardElement.querySelector(`[data-coord="${coord}"]`);
            if (targetCell) {
                targetCell.classList.add('ship-overlay-valid');
            }
        });
    } else {
        coords.forEach(coord => {
            const targetCell = myBoardElement.querySelector(`[data-coord="${coord}"]`);
            if (targetCell) {
                targetCell.classList.add('ship-overlay-invalid');
            }
        });
    }
}

function handleRotate(e) {
    if (!currentDragShip) return;
    
    currentDragShip.orientation = currentDragShip.orientation === 'horizontal' ? 'vertical' : 'horizontal';
    
    // Обновляем превью на новой ориентации
    if (currentDragCell) {
        handleDragOverCell(currentDragCell);
    }
    // Находим элемент в списке и меняем его ориентацию
    const shipElementInList = shipList.querySelector(`[data-ship-id="${currentDragShip.id}"]`);
    if(shipElementInList) {
        shipElementInList.dataset.orientation = currentDragShip.orientation;
        shipElementInList.classList.toggle('rotated', currentDragShip.orientation === 'vertical');
    }
}

function handleDragEnd(e) {
    if (!currentDragShip) return;

    const targetCell = e.target.closest('.cell');
    
    if (targetCell && targetCell.dataset.coord) {
        const r = parseInt(targetCell.dataset.row);
        const c = parseInt(targetCell.dataset.col);
        
        const { isValid, coords, isConflict } = getShipCoordinates(r, c, currentDragShip);

        if (isValid && !isConflict) {
            placeShip(currentDragShip, r, c, coords);
        } else if (isValid && isConflict) {
            // Если валидно, но конфликт, то это означает, что мы хотим переместить корабль
            removeShip(currentDragShip.id); // Удаляем старую позицию
            const { isValid: newValid, coords: newCoords } = getShipCoordinates(r, c, currentDragShip);
             if (newValid) {
                placeShip(currentDragShip, r, c, newCoords);
            } else {
                // Если не удалось разместить, возвращаем на место
                renderMyBoardPlacement();
                alert("Нельзя разместить корабль здесь из-за правил соприкосновения.");
            }
        } else {
            // Очистка, если бросили мимо
            renderMyBoardPlacement();
        }
    }
    
    // Общая очистка
    clearShipPreview();
    currentDragShip = null;
    currentDragCell = null;
    document.body.style.cursor = 'default';
    shipList.querySelector('.is-dragging')?.classList.remove('is-dragging');
    
    checkPlacementComplete();
}

function clearShipPreview() {
    myBoardElement.querySelectorAll('.ship-overlay-valid, .ship-overlay-invalid').forEach(cell => {
        cell.classList.remove('ship-overlay-valid', 'ship-overlay-invalid');
    });
}

function removeShip(shipId) {
    const shipIndex = myShips.findIndex(s => s.id === shipId);
    if (shipIndex === -1 || !myShips[shipIndex].placed) return;
    
    myShips[shipIndex].placed = false;
    myShips[shipIndex].startCoord = null;
    myShips[shipIndex].coords = [];
    
    // Возвращаем корабль в список (делаем его перетаскиваемым снова)
    shipList.querySelector(`[data-ship-id="${shipId}"]`).classList.remove('ship-placed');
    renderMyBoardPlacement();
}

function placeShip(ship, r, c, coords) {
    ship.placed = true;
    ship.startCoord = `${r}-${c}`;
    ship.coords = coords;
    
    // Скрываем из списка
    shipList.querySelector(`[data-ship-id="${ship.id}"]`).classList.add('ship-placed');
    
    renderMyBoardPlacement();
}

function getShipCoordinates(r, c, ship) {
    const coords = [];
    let isValid = true;
    let isConflict = false;
    
    for (let i = 0; i < ship.size; i++) {
        let row = r;
        let col = c;
        
        if (ship.orientation === 'horizontal') {
            col += i;
        } else {
            row += i;
        }

        if (row < 1 || row > BOARD_SIZE || col < 1 || col > BOARD_SIZE) {
            isValid = false; // Выход за пределы
            break;
        }
        
        const coord = `${row}-${col}`;
        coords.push(coord);
        
        // Проверка на столкновение с другими кораблями (исключая текущий, если он уже размещен)
        if (isShipConflict(row, col, ship.id)) {
            isConflict = true; 
        }
        
        // Проверка на соприкосновение с другими кораблями
        if (isAdjacentToOtherShip(row, col, ship.id)) {
            isValid = false; 
        }
    }
    
    return { isValid, coords, isConflict };
}

// Проверяет, что новая позиция не конфликтует с уже размещенными кораблями
function isShipConflict(r, c, currentShipId) {
    const coord = `${r}-${c}`;
    return myShips.some(s => s.placed && s.id !== currentShipId && s.coords.includes(coord));
}

// Проверяет соприкосновение по диагонали/сторонам с другими кораблями
function isAdjacentToOtherShip(r, c, currentShipId) {
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue; 
            
            const neighborCoord = `${r + dr}-${c + dc}`;
            
            // Проверяем все размещенные корабли, кроме текущего
            const isAdjacent = myShips.some(s => 
                s.placed && s.id !== currentShipId && s.coords.includes(neighborCoord)
            );
            
            if (isAdjacent) return true;
        }
    }
    return false;
}

function renderMyBoardPlacement() {
    // Удаляем все предыдущие корабли
    myBoardElement.querySelectorAll('.ship-overlay').forEach(el => el.remove());
    
    myShips.forEach(ship => {
        if (ship.placed && ship.coords.length > 0) {
            ship.coords.forEach(coord => {
                const cell = myBoardElement.querySelector(`[data-coord="${coord}"]`);
                if (cell) {
                    // Используем наложение (overlay) для отображения корабля
                    const overlay = document.createElement('div');
                    overlay.className = 'ship-overlay';
                    cell.appendChild(overlay);
                }
            });
        }
    });
}

function checkPlacementComplete() {
    const placedCount = myShips.filter(s => s.placed).length;
    const isComplete = placedCount === SHIP_CONFIG.length;
    startBattleButton.disabled = !isComplete;
    return isComplete;
}

// --- ЛОГИКА РАНДОМА ---
function placeShipsRandomly() {
    // Сначала очищаем поле и список
    myShips.forEach(s => removeShip(s.id));
    
    const allCells = [];
    for (let r = 1; r <= BOARD_SIZE; r++) {
        for (let c = 1; c <= BOARD_SIZE; c++) {
            allCells.push({ r, c });
        }
    }
    
    // Используем Map для отслеживания доступных клеток и прилегающих зон
    const placementMap = new Map(); // Key: coord, Value: boolean (true if occupied/adjacent)
    
    SHIP_CONFIG.forEach(size => {
        const ship = myShips.find(s => s.size === size && !s.placed); // Находим первый неразмещенный
        if (!ship) return;

        let placed = false;
        let attempts = 0;
        
        while (!placed && attempts < 1000) {
            // 1. Собираем список реально свободных клеток для начала размещения
            const availableStarts = allCells.filter(c => !placementMap.has(`${c.r}-${c.c}`));
            
            if (availableStarts.length === 0) break; // Невозможно разместить

            const startCellIndex = Math.floor(Math.random() * availableStarts.length);
            const startR = availableStarts[startCellIndex].r;
            const startC = availableStarts[startCellIndex].c;
            
            // 2. Выбираем случайную ориентацию
            ship.orientation = Math.random() < 0.5 ? 'horizontal' : 'vertical';
            
            const { isValid, coords } = checkPlacementValidity(startR, startC, ship, placementMap);

            if (isValid) {
                // 3. Размещение
                placeShip(ship, startR, startC, coords);
                
                // 4. Блокируем занятые и прилегающие клетки
                coords.forEach(coord => {
                    const [r, c] = coord.split('-').map(Number);
                    
                    // Блокируем саму клетку
                    placementMap.set(coord, true);

                    // Блокируем прилегающие клетки
                    for (let dr = -1; dr <= 1; dr++) {
                        for (let dc = -1; dc <= 1; dc++) {
                            const neighborCoord = `${r + dr}-${c + dc}`;
                            // Проверяем границы, но не саму клетку (она уже заблокирована)
                            if (r + dr >= 1 && r + dr <= BOARD_SIZE && c + dc >= 1 && c + dc <= BOARD_SIZE) {
                                placementMap.set(neighborCoord, true);
                            }
                        }
                    }
                });
                
                placed = true;
            }
            attempts++;
        }
        if (!placed) {
            console.error(`Не удалось разместить корабль размера ${ship.size}.`);
        }
    });

    // Обновляем список кораблей
    myShips.forEach(ship => {
        const shipElementInList = shipList.querySelector(`[data-ship-id="${ship.id}"]`);
        shipElementInList.classList.toggle('ship-placed', ship.placed);
        if(ship.placed) {
             shipElementInList.dataset.orientation = ship.orientation;
             shipElementInList.classList.toggle('rotated', ship.orientation === 'vertical');
        }
    });

    renderMyBoardPlacement();
    checkPlacementComplete();
}

// Вспомогательная функция для проверки размещения в рандоме
function checkPlacementValidity(r, c, ship, placementMap) {
    const coords = [];
    
    for (let i = 0; i < ship.size; i++) {
        let row = r;
        let col = c;
        
        if (ship.orientation === 'horizontal') {
            col += i;
        } else {
            row += i;
        }
        
        if (row < 1 || row > BOARD_SIZE || col < 1 || col > BOARD_SIZE) {
            return { isValid: false, coords: [] }; 
        }
        
        const coord = `${row}-${col}`;
        coords.push(coord);
        
        // Проверяем, свободна ли клетка
        if (placementMap.has(coord)) {
             return { isValid: false, coords: [] };
        }
        
        // В рандоме проверяем только саму клетку, так как прилегающие клетки
        // были заблокированы после размещения предыдущих кораблей.
    }
    
    return { isValid: true, coords };
}
