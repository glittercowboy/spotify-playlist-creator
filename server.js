// server.js
// Import the Express library
const express = require('express');

// Create an instance of the Express application
const app = express();

// Define the port number where your server will listen.
// We'll use 8888 since that's a common choice for local development.
const PORT = 8888;

/*
 * Define the /callback route.
 * This is where Spotify will redirect the user after they log in and authorize your app.
 * Spotify will append query parameters like 'code' (the authorization code).
 */
app.get('/callback', (req, res) => {
  // Extract the 'code' parameter from the query string.
  // Example URL: http://localhost:8888/callback?code=AUTH_CODE_HERE
  const authorizationCode = req.query.code;

  // Check if the authorization code is present
  if (authorizationCode) {
    // Log the code to the terminal for debugging purposes.
    console.log(`Received authorization code: ${authorizationCode}`);

    // This is where you would normally exchange the authorization code for an access token.
    // For now, we simply send a response back to the browser.
    res.send('Authorization code received! Check your terminal for details.');
  } else {
    // If no code is found in the query, notify the user.
    res.send('No authorization code found in the query parameters.');
  }
});

/*
 * Start the server.
 * The server will listen for requests on the port defined above.
 */
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log('Waiting for Spotify OAuth callback...');
});