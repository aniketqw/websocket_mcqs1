// add-mcq.js
const fs = require('fs');
const path = require('path');

// Handle POST requests to /add-mcq
function handleAddMCQ(req, res, mcqsCollection, mcqs) {
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

      // Ensure the new MCQ has the correct structure
      if (!newMCQ.question || !Array.isArray(newMCQ.options) || typeof newMCQ.correctOption !== 'number') {
        throw new Error('Invalid MCQ format');
      }

      const result = await mcqsCollection.insertOne(newMCQ);
      console.log('MCQ inserted into MongoDB:', result);

      mcqs.push(newMCQ);
      console.log('MCQ added to in-memory array:', mcqs);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success' }));

      // Broadcast the new MCQ to all clients
      broadcastMCQ();
    } catch (error) {
      console.error("Error adding MCQ:", error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: error.message }));
    }
  });
}

module.exports = handleAddMCQ;
