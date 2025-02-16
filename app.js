// server.js

// Load environment variables from .env file
require('dotenv').config();

// Required Libraries
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const axios = require('axios');
const querystring = require('querystring');

// Create Express app, HTTP server, and attach Socket.io
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Middleware: Parse URL-encoded bodies (for form submissions)
app.use(express.urlencoded({ extended: true }));

// Serve static files from the "public" folder (for index.html, CSS, etc.)
app.use(express.static('public'));

// Configuration from environment variables
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI; // e.g., http://localhost:8888/callback
const PORT = process.env.PORT || 8888;
const SCOPES = 'playlist-modify-private';

// Global variable for the current label name
let currentLabel = '';

// Helper: Sleep for a given number of milliseconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --------------------
// Real Spotify API Call Functions
// --------------------

// Get the current user’s profile
async function getUserProfile(token) {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching user profile:', error.response?.data || error.message);
    throw error;
  }
}

// Exchange authorization code for access token
async function getAccessToken(code) {
  const tokenURL = 'https://accounts.spotify.com/api/token';
  const data = querystring.stringify({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: REDIRECT_URI,
  });
  const authHeader = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  try {
    const response = await axios.post(tokenURL, data, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${authHeader}`,
      },
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error obtaining access token:', error.response?.data || error.message);
    throw error;
  }
}

// Search for albums by label (with pagination)
async function searchAlbumsByLabel(label, token) {
  const searchURL = 'https://api.spotify.com/v1/search';
  const query = `label:"${label}"`;
  let albums = [];
  const limit = 50;
  let offset = 0;
  let total = 0;

  do {
    try {
      const response = await axios.get(searchURL, {
        headers: { 'Authorization': `Bearer ${token}` },
        params: {
          q: query,
          type: 'album',
          market: 'US',
          limit: limit,
          offset: offset,
        },
      });
      const items = response.data.albums.items;
      total = response.data.albums.total;
      albums = albums.concat(items);
      offset += limit;
      io.emit('progress', { message: `Fetched ${albums.length} of ${total} albums...`, percent: 40 });
      await sleep(500);
    } catch (error) {
      console.error('Error searching for albums:', error.response?.data || error.message);
      throw error;
    }
  } while (offset < total);

  return albums;
}

// Get tracks from a given album
async function getAlbumTracks(albumId, token) {
  const albumTracksURL = `https://api.spotify.com/v1/albums/${albumId}/tracks`;
  try {
    const response = await axios.get(albumTracksURL, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { market: 'US', limit: 50 }
    });
    return response.data.items;
  } catch (error) {
    console.error(`Error fetching tracks for album ${albumId}:`, error.response?.data || error.message);
    throw error;
  }
}

// Create a new playlist in the user's account
async function createPlaylist(userId, token, label) {
  const createPlaylistURL = `https://api.spotify.com/v1/users/${userId}/playlists`;
  const playlistName = `Label Playlist: ${label} (Chronological)`;
  const data = {
    name: playlistName,
    public: false,
    description: `A chronological playlist of songs from albums tagged with "${label}".`
  };

  try {
    const response = await axios.post(createPlaylistURL, data, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error creating playlist:', error.response?.data || error.message);
    throw error;
  }
}

// Add tracks to a playlist in batches (max 100 per request)
async function addTracksToPlaylist(playlistId, trackURIs, token) {
  const addTracksURL = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  const BATCH_SIZE = 100;

  for (let i = 0; i < trackURIs.length; i += BATCH_SIZE) {
    const batch = trackURIs.slice(i, i + BATCH_SIZE);
    try {
      await axios.post(addTracksURL, { uris: batch }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
      });
      io.emit('progress', { message: `Added batch ${Math.floor(i / BATCH_SIZE) + 1} of tracks.`, percent: 90 });
      await sleep(300);
    } catch (error) {
      console.error('Error adding tracks to playlist:', error.response?.data || error.message);
      throw error;
    }
  }
}

// --------------------
// Express Routes
// --------------------

// Serve the main page with the search form
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Handle form submission: capture the label and start the OAuth flow
app.post('/start', (req, res) => {
  currentLabel = req.body.label;
  console.log(`Label received: ${currentLabel}`);

  // Build Spotify's authorization URL
  const authURL = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: 'some-random-state'
  });
  // Redirect the user to Spotify for authentication
  res.redirect(authURL);
});

// OAuth callback route: process the authorization code and create the playlist
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    res.send('Error: No authorization code provided.');
    return;
  }

  try {
    io.emit('progress', { message: 'Received authorization code.', percent: 10 });

    // Exchange code for access token
    const accessToken = await getAccessToken(code);
    io.emit('progress', { message: 'Access token received.', percent: 20 });

    // Get the current user's profile
    const userProfile = await getUserProfile(accessToken);
    io.emit('progress', { message: `Logged in as ${userProfile.display_name} (${userProfile.id}).`, percent: 30 });
    
    // Search for albums matching the label
    const albums = await searchAlbumsByLabel(currentLabel, accessToken);
    io.emit('progress', { message: `Found ${albums.length} albums for label "${currentLabel}".`, percent: 40 });

    // For each album, get its tracks and attach release date info
    let allTracks = [];
    for (const album of albums) {
      const albumTracks = await getAlbumTracks(album.id, accessToken);
      albumTracks.forEach(track => {
        track.albumReleaseDate = album.release_date;
        track.albumTrackNumber = track.track_number;
      });
      allTracks = allTracks.concat(albumTracks);
      io.emit('progress', { message: `Processed album "${album.name}".`, percent: 45 });
      await sleep(200);
    }

    if (allTracks.length === 0) {
      io.emit('progress', { message: `No tracks found for label "${currentLabel}".`, percent: 50 });
      res.send('No tracks found.');
      return;
    }

    // Sort all tracks in chronological order (by album release date then track number)
    allTracks.sort((a, b) => {
      const dateA = new Date(a.albumReleaseDate);
      const dateB = new Date(b.albumReleaseDate);
      if (dateA.getTime() === dateB.getTime()) {
        return a.albumTrackNumber - b.albumTrackNumber;
      }
      return dateA - dateB;
    });
    io.emit('progress', { message: `Total tracks to add: ${allTracks.length}.`, percent: 65 });

    // Extract track URIs
    const trackURIs = allTracks.map(track => track.uri);

    // Create a new playlist in the user's account
    const newPlaylist = await createPlaylist(userProfile.id, accessToken, currentLabel);
    io.emit('progress', { message: `Created playlist "${newPlaylist.name}".`, percent: 80 });

    // Add tracks to the new playlist in batches
    await addTracksToPlaylist(newPlaylist.id, trackURIs, accessToken);
    io.emit('progress', { message: 'All tracks added to the playlist successfully.', percent: 90 });

    // Final update: processing complete
    io.emit('progress', { message: 'Processing complete. Check the main page for progress updates.', playlist: newPlaylist.external_urls.spotify, percent: 100 });

    // Send a styled completion page as the response
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Processing Complete</title>
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600&display=swap" rel="stylesheet">
        <style>
          body {
            background-color: #f4f4f4;
            margin: 0;
            font-family: 'Montserrat', sans-serif;
            color: #333;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
          }
          .message-box {
            background: #fff;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            text-align: center;
          }
          h2 {
            color: #283593;
          }
          p {
            margin-top: 20px;
            font-size: 16px;
          }
          a {
            color: #283593;
            text-decoration: none;
            font-weight: 600;
          }
          a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>
        <div class="message-box">
          <h2>Processing Complete</h2>
          <p>You can now close this window and check the main page for progress updates.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error during processing:', error.message);
    res.send('Error during processing. Check the server logs for details.');
  }
});

// --------------------
// Start the Server
// --------------------
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});