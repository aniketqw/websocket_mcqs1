const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { MongoClient, ServerApiVersion } = require('mongodb');

const PORT = 8080; // Update to match your port number
const uri = "mongodb+srv://aniket:<db_password>@mcqs.g8pgr.mongodb.net/?retryWrites=true&w=majority&appName=mcqs";

let mcqs = [];
let currentQuestionIndex = 0;
let isAdminAssigned = false;
let adminSocket = null; // Track the admin socket

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();

    // Fetch the MCQs from the database
    const db = client.db("mcqBattle");
    const mcqsCollection = db.collection("mcqs");
    mcqs = await mcqsCollection.find().toArray();
    console.log('Loaded MCQs from MongoDB:', mcqs);
  } catch (error) {
    console.error("Failed to connect to MongoDB", error);
  }
}

// Start the MongoDB connection
run().catch(console.dir);

const server = http.createServer((req, res) => {
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

  if (req.method === 'POST' && req.url === '/add-mcq') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      const newMCQ = JSON.parse(body);
      const db = client.db("mcqBattle");
      const mcqsCollection = db.collection("mcqs");

      await mcqsCollection.insertOne(newMCQ);
      mcqs.push(newMCQ); // Add the new MCQ to the in-memory list

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success' }));
    });
  }
});

const wsServer = new WebSocket.Server({ server });

let userID = 0;
const clients = new Map();
const answeredClients = new Set(); // Track clients who have answered

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

  // Broadcast the current MCQ to the new client
  if (!isAdmin) broadcastMCQ();

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

      // Track that this client has answered
      answeredClients.add(socket);

      // Check if all clients have answered
      if (answeredClients.size === clients.size) {
        // All clients have answered, move to the next question
        if (currentQuestionIndex < mcqs.length - 1) {
          currentQuestionIndex++;
          answeredClients.clear(); // Clear the set for the next question
          broadcastMCQ();
        } else {
          broadcastScores(); // Broadcast final scores after the last question
        }
      }
    }
  });

  socket.on('close', () => {
    console.log(`${clients.get(socket).userName} has disconnected`);
    clients.delete(socket);
    answeredClients.delete(socket); // Remove client from the answered set

    if (socket === adminSocket) {
      isAdminAssigned = false; // Allow the next user to become the admin
      adminSocket = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Listening on: http://localhost:${server.address().port}`);
});
