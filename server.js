const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

let mcqs = [
  {
    id: 1,
    question: "What is the capital of France?",
    options: ["Paris", "Berlin", "Rome", "Madrid"],
    correctOption: 0
  },
  {
    id: 2,
    question: "Which planet is known as the Red Planet?",
    options: ["Earth", "Mars", "Jupiter", "Saturn"],
    correctOption: 1
  },
];

let nextMcqId = 3;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream('./public/index.html').pipe(res);
  } else if (req.method === 'GET' && req.url === '/api/mcqs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(mcqs));
  } else if (req.method === 'POST' && req.url === '/api/mcqs') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const newMcq = JSON.parse(body);
      newMcq.id = nextMcqId++;
      mcqs.push(newMcq);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newMcq));
    });
  } else if (req.method === 'DELETE' && req.url.startsWith('/api/mcqs/')) {
    const id = parseInt(req.url.split('/').pop());
    mcqs = mcqs.filter(mcq => mcq.id !== id);
    res.writeHead(204);
    res.end();
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

const wsServer = new WebSocket.Server({ server });
let userID = 0;
const clients = new Map();

wsServer.on('connection', (socket) => {
  userID++;
  const currentUser = `User${userID}`;
  clients.set(socket, { userName: currentUser, score: 0, answered: false });
  socket.send(JSON.stringify({ type: 'init', data: { user: currentUser, mcq: mcqs[0] } }));
  console.log(`${currentUser} has connected to the server`);

  socket.on('message', (data) => {
    const parsedData = JSON.parse(data);
    if (parsedData.type === 'answer') {
      const client = clients.get(socket);
      const currentMCQ = mcqs.find(mcq => mcq.id === parsedData.mcqId);

      if (parsedData.answer === currentMCQ.correctOption) {
        client.score += 1;
        socket.send(JSON.stringify({ type: 'result', data: 'Correct!' }));
      } else {
        socket.send(JSON.stringify({ type: 'result', data: 'Incorrect!' }));
      }

      client.answered = true;

      if ([...clients.values()].every(c => c.answered)) {
        clients.forEach(c => c.answered = false);
        broadcastMCQ();
      }
    }
  });

  socket.on('close', () => {
    clients.delete(socket);
  });
});

function broadcastMCQ() {
  const nextMCQ = mcqs.find(mcq => ![...clients.values()].some(c => c.answered && c.mcqId === mcq.id));
  wsServer.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'mcq', data: nextMCQ }));
    }
  });
}

server.listen(8080, () => {
  console.log('Server is listening on http://localhost:8080');
});
