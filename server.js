const http = require('http'); 
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8080; // Update to match your port number

const mcqs = [
  {
    question: "What is the capital of France?",
    options: ["Paris", "Berlin", "Rome", "Madrid"],
    correctOption: 0
  },
  {
    question: "Which planet is known as the Red Planet?",
    options: ["Earth", "Mars", "Jupiter", "Saturn"],
    correctOption: 1
  }
];

let currentQuestionIndex = 0;

const server = http.createServer((req, res) => {
  const filePath = (req.url === '/') ? '/public/index.html' : req.url;
  const extname = path.extname(filePath);
  let contentType = 'text/html';

  if (extname === '.js') contentType = 'text/javascript';
  else if (extname === '.css') contentType = 'text/css';
  else if (extname === '.ico') contentType = 'image/x-icon'; // Handle favicon.ico

  const fullPath = path.join(__dirname, filePath);
  
  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404 Not Found</h1>');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(fullPath).pipe(res);
  });
});

const wsServer = new WebSocket.Server({ server });

let userID = 0;
const clients = new Map();

function broadcastMCQ() {
  const currentMCQ = mcqs[currentQuestionIndex];
  const mcqData = {
    question: currentMCQ.question,
    options: currentMCQ.options
  };

  wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'mcq', data: mcqData }));
    }
  });
}

function broadcastScores() {
  const scores = Array.from(clients.values()).map(client => ({
    user: client.userName,
    score: client.score
  }));

  wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'scores', data: scores }));
    }
  });
}

wsServer.on('connection', (socket) => {
  userID++;
  const currentUser = `User${userID}`;
  clients.set(socket, { userName: currentUser, score: 0 });
  socket.send(JSON.stringify({ type: 'user', data: `You are connected as ${currentUser}` }));
  console.log(`${currentUser} has connected to the server`);

  broadcastMCQ();

  socket.on('message', (data) => {
    const parsedData = JSON.parse(data);
    if (parsedData.type === 'answer') {
      const client = clients.get(socket);
      const currentMCQ = mcqs[currentQuestionIndex];

      if (parsedData.answer === currentMCQ.correctOption) {
        client.score += 1;
        socket.send(JSON.stringify({ type: 'result', data: 'Correct!' }));
      } else {
        socket.send(JSON.stringify({ type: 'result', data: 'Incorrect!' }));
      }

      if (currentQuestionIndex < mcqs.length - 1) {
        currentQuestionIndex++;
        broadcastMCQ();
      } else {
        broadcastScores();
      }
    }
  });

  socket.on('close', () => {
    console.log(`${clients.get(socket).userName} has disconnected`);
    clients.delete(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Listening on: http://localhost:${server.address().port}`);
});
