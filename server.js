const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { MongoClient, ServerApiVersion } = require('mongodb');

const PORT = 8080;
const uri = "";

let mcqs = [];
let currentQuestionIndex = 0;
let isAdminAssigned = false;
let adminSocket = null;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db, mcqsCollection;

async function run() {
  try {
    await client.connect();
    db = client.db("mcqBattle");
    mcqsCollection = db.collection("mcqs");
    mcqs = await mcqsCollection.find().toArray();
    console.log('Loaded MCQs from MongoDB:', mcqs);
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
  }
}

run().catch(console.dir);

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    const filePath = (req.url === '/') ? '/public/index.html' : req.url;
    const extname = path.extname(filePath);
    let contentType = 'text/html';

    if (extname === '.js') contentType = 'text/javascript';
    else if (extname === '.css') contentType = 'text/css';
    else if (extname === '.ico') contentType = 'image/x-icon';

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
  } else if (req.method === 'POST' && req.url === '/add-mcq') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      if (!mcqsCollection) {
        console.error('Database connection is not established.');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Database not connected' }));
        return;
      }

      try {
        const newMCQ = JSON.parse(body);
        console.log('Received new MCQ:', newMCQ);

        const result = await mcqsCollection.insertOne(newMCQ);
        console.log('MCQ inserted into MongoDB:', result);

        mcqs.push(newMCQ);
        console.log('MCQ added to in-memory array:', mcqs);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success' }));

        // Broadcast the new MCQ to all clients
        broadcastMCQ();
      } catch (error) {
        console.error("Error adding MCQ:", error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Failed to add MCQ' }));
      }
    });
  }
});

const wsServer = new WebSocket.Server({ server });

let userID = 0;
const clients = new Map();
const answeredClients = new Set();

function broadcastMCQ() {
  if (mcqs.length === 0) {
    console.error('No MCQs found in the database.');
    return;
  }

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
      console.log(client.userID);
      client.send(JSON.stringify({ type: 'scores', data: scores }));
    }
  });
}

wsServer.on('connection', (socket) => {
  userID++;
  const currentUser = `User${userID}`;
  const isAdmin = !isAdminAssigned;

  if (isAdmin) {
    isAdminAssigned = true;
    adminSocket = socket;
    socket.send(JSON.stringify({ type: 'admin', data: `You are the admin as ${currentUser}` }));
  } else {
    socket.send(JSON.stringify({ type: 'user', data: `You are connected as ${currentUser}` }));
  }

  clients.set(socket, { userName: currentUser, score: 0 });
  console.log(`${currentUser} has connected to the server as ${isAdmin ? 'Admin' : 'User'}`);

  if (!isAdmin && mcqs.length > 0) broadcastMCQ();

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

      answeredClients.add(socket);

      if (answeredClients.size === clients.size - 1) { // Exclude admin
        if (currentQuestionIndex < mcqs.length - 1) {
          currentQuestionIndex++;
          answeredClients.clear();
          broadcastMCQ();
        } else {
          broadcastScores();
        }
      }
    } else if (parsedData.type === 'start-game' && socket === adminSocket) {
      currentQuestionIndex = 0;
      answeredClients.clear();
      broadcastMCQ();
    }
  });

  socket.on('close', () => {
    console.log(`${clients.get(socket).userName} has disconnected`);
    clients.delete(socket);
    answeredClients.delete(socket);

    if (socket === adminSocket) {
      isAdminAssigned = false;
      adminSocket = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Listening on: http://localhost:${server.address().port}`);
});
