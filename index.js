const { client } = require('websocket');
const CellType = require('./celltype.js');
const http = require("http");
const app = require("express")();

const httpServer = http.createServer(app);
const PORT = process.env.PORT || 8080;

app.get("/", (req,res)=> res.sendFile(__dirname + "/index.html"))
httpServer.listen(PORT, () => console.log("Listening on port " + PORT))

const websocketServer = require("websocket").server
const wsServer = new websocketServer({
    "httpServer": httpServer
});

const clients = {}
const games = {}

wsServer.on("request", (request) => 
{
    const connection = request.accept(null, request.origin);
    connection.on("open", () => console.log("opened!"))

    connection.on("close", () => {
        const disconnectedClientId = Object.entries(clients).find(([, conn]) => conn === connection)?.[0];
        
        if (disconnectedClientId) 
        {
            console.log(`Client disconnected! ${disconnectedClientId}`);
            delete clients[disconnectedClientId];
                
            // Find gameId from the games object
            const gameIdToTerminate = Object.entries(games).find(([, game]) => 
                game.clients.some(client => client.id == disconnectedClientId)
            )?.[0];
            
            if(gameIdToTerminate)
            {
                const payload = {
                    "method": "opponentDisconnected",
                }
    
                // Notify connected client of disconnected opponent
                games[gameIdToTerminate].clients.forEach(client => {
                    if(client.id != disconnectedClientId)
                    {
                        const con = clients[client.id];
                        con.send(JSON.stringify(payload));
                    }
                });
    
                console.log(`Terminating game! ${gameIdToTerminate}`);
                delete games[gameIdToTerminate];
            }
        };
    });

    connection.on("message", message => 
    {
        const result = JSON.parse(message.utf8Data);
        
        // Create Game
        if(result.method === "create")
        {
            const gameId = getRandomId();
            games[gameId] = {
                "id" : gameId,
                "creationDate": new Date(), 
                "board":  getEmptyBoard(),
                "clients": [],
                "currentClientTurn": null
            };

            const payload = {
                "method": "create",
                "gameState" : games[gameId],
            };

            connection.send(JSON.stringify(payload));
        }

        // Join Game
        if(result.method === "join")
        {
            const clientId = result.clientId;
            const gameId = result.gameId;

            const gameState = games[gameId];
            
            let errorMsg = null;
            let errorFound = false;

            if(gameState === undefined || gameState === null)
            {
                errorFound = true;
                errorMsg = "Unable to find a game with that ID!";
            }
            else if(gameState.clients != null && gameState.clients.length >= 2)
            {
                errorFound = true;
                errorMsg = "Game session is already full!";
            }

            if(errorFound)
            {
                const payload = {
                    "method": "join",
                    "errorFound": true,
                    "errorMsg": errorMsg
                }

                connection.send(JSON.stringify(payload));
                return;
            }

            const client = {
                "id": clientId,
                "mark": getPlayerMark(gameState)
            };

            if(gameState.clients.length == 0)
            {
                gameState.currentClientTurn = clientId;
            }

            gameState.clients.push(client);
            games[gameId] = gameState;

            const payload = {
                "method": "join",
                "gameState": gameState
            }

            connection.send(JSON.stringify(payload));
        }

        // Play Game
        if(result.method === "play")
        {
            const clientId = result.clientId;
            const gameId = result.gameId;

            const gameState = games[gameId];

            const rowClicked = result.rowClicked;
            const columnClicked = result.columnClicked;
            
            let errorMsg = null;
            let errorFound = false;

            if(gameState === undefined ||gameState === null)
            {
                errorFound = true;
                errorMsg = "Unable to find a game with that ID!";
            }
            else if(gameState.clients.length < 2)
            {
                errorFound = true;
                errorMsg = "Waiting for another player to connect!";
            }
            else if(!gameState.clients.some(client => client.id === clientId))
            {
                errorFound = true;
                errorMsg = "Client not authorized!";
            }
            else if(gameState.currentClientTurn === null || 
                gameState.currentClientTurn !== clientId)
            {
                errorFound = true;
                errorMsg = "Not your turn!";
            }
            else if(gameState.board[rowClicked][columnClicked] !== "")
            {
                errorFound = true;
                errorMsg = "Invalid selection!";
            }
            else if(gameState.hasEnded != undefined && gameState.hasEnded == true)
            {
                errorFound = true;
                errorMsg = "Game has ended!";
            }

            if(errorFound)
            {
                const payload = {
                    "method": "play",
                    "errorFound": errorFound,
                    "errorMsg": errorMsg
                }
             
                connection.send(JSON.stringify(payload));
                return;
            }

            const player = gameState.clients.find(client => client.id === clientId);
            gameState.board[rowClicked][columnClicked] = player.mark;
            gameState.currentClientTurn = gameState.clients.find(client => client.id !== clientId).id;

            const payload = {
                "method": "play",
                "gameState": gameState
            }

            connection.send(JSON.stringify(payload));
        }

        // Rematch
        if(result.method === "rematch")
        {
            const clientRequestingRematch = result.clientId;
            const gameId = result.gameId;

            const gameState = games[gameId];

            gameState.clients.forEach(client => 
            {
                if(client.id == clientRequestingRematch)
                {
                    client.rematchRequest = true;
                }
            });

            const beginRematch = gameState.clients.every(client => client.rematchRequest === true);
            if(beginRematch)
            {
                gameState.board = getEmptyBoard();

                gameState.clients.forEach(client => 
                {
                    client.rematchRequest = false;
                });
            }

            games[gameId] = gameState;

            const payload = {
                "method": "rematch",
                "clientId": clientId,
                "gameState": gameState,
                "beginRematch": beginRematch
            }

            gameState.clients.forEach(client => {
                clients[client.id].send(JSON.stringify(payload));
            });
        }

        // End Game
        if(result.method === "endGame")
        {
            const clientId = result.clientId;
            const gameId = result.gameId;

            const gameState = games[gameId];
            
            let errorMsg = null;
            let errorFound = false;

            if(gameState === undefined || gameState === null)
            {
                errorFound = true;
                errorMsg = "Unable to find a game with that ID!";
            }

            if(errorFound)
            {
                const payload = {
                    "method": "endGame",
                    "errorFound": true,
                    "errorMsg": errorMsg
                }

                connection.send(JSON.stringify(payload));
                return;
            }
            
            console.log(`Client ${clientId} requested game ${gameId} to end.`);

            // Close all associated clients of the game
            gameState.clients.forEach(client => {
                const payload = {
                    "method": "endGame",
                    "clientId": clientId
                };

                const con = clients[client.id];
                con.send(JSON.stringify(payload));
            });          
            
            // Terminate game
            console.log(`Terminating game ${gameId}`);
            delete games[gameId];
        }
    });

    const clientId = getRandomId();
    clients[clientId] = connection;

    const response = {
        "method": "connect",
        "clientId" : clientId
    };

    connection.send(JSON.stringify(response));
});

const updateGameState = () =>
{
    for(const gameId in games)
    {
        const game = games[gameId];
        
        if(game.clients === undefined || game.clients === null)
        {
            console.log(`Terminating invalid game! ${gameId}`);
            delete games[gameId];
            continue;
        }
        
        const currentDate = new Date();
        const differenceInMinutes = (currentDate - game.creationDate) / (1000 * 60);
        if(game.clients.length === 0 && differenceInMinutes > 0.1)
        {
            console.log(`Terminating stale game! ${gameId}`);
            delete games[gameId];
            continue;
        }
        
        game.gameWinner = getGameWinner(game);

        if(boardIsFull(game.board) || game.gameWinner !== null)
        {
            game.hasEnded = true;
        }
        else
        {
            game.hasEnded = false;
        }

        const payload = {
            "method": "update",
            "gameState": game,
        };
    
        game.clients.forEach(client => {
            clients[client.id].send(JSON.stringify(payload));
        });
    }
    
    setTimeout(updateGameState, 500);
    return;
};

// TODO: Find a better way to trigger the start this update
updateGameState();

const getGameWinner = (gameState) => {
    for(let i = 0; i < gameState.clients.length; i++)
    {
        let client = gameState.clients[i];
        if(checkForWinCondition(gameState.board, client.mark))
        {
            return client.id;
        }
    }
    
    return null;
};

const checkForWinCondition = (board, mark) =>
{
    for(let row = 0; row < board.length; row++)
    {
        if(board[row][0] === mark && board[row][1] === mark && board[row][2] === mark)
        {
            return true;
        }
    }

    for(let column = 0; column < board[0].length; column++)
    {
        if(board[0][column] === mark && board[1][column] === mark && board[2][column] === mark)
        {
            return true;
        }
    }

    if(board[0][0] === mark && board[1][1] === mark && board[2][2] === mark)
    {
        return true;
    }
    else if(board[2][0] === mark && board[1][1] === mark && board[0][2] === mark)
    {
        return true;
    }

    return false;
};

const boardIsFull = (board) => 
{
    for(let row = 0; row < board.length; row++)
    {
        for(let column = 0; column < board[0].length; column++)
        {
            if(board[row][column] === "")
            {
                return false;
            }
        }
    }

    return true;
};


const getRandomId = () => 
{
    return Math.floor(Math.random() * 10000) + 1
};

const getEmptyBoard = () => [
    [CellType.EMPTY, CellType.EMPTY, CellType.EMPTY],
    [CellType.EMPTY, CellType.EMPTY, CellType.EMPTY],
    [CellType.EMPTY, CellType.EMPTY, CellType.EMPTY]
]

const getPlayerMark = (gameState) => 
{
    if(gameState.clients.length > 0)
    {
        return gameState.clients[0].mark === "X" ? "O" : "X";
    }

    return Math.random() > 0.5 ? "X" : "O";
}