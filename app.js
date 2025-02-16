/*
 * app.js
 *
 * This application:
 * 1. Reads a record label name from the command line.
 * 2. Starts an Express server to handle Spotify’s OAuth callback.
 * 3. Opens your browser for Spotify authentication.
 * 4. Exchanges the authorization code for an access token.
 * 5. Searches for albums using a query like: label:"Label Name" and paginates through all results.
 * 6. Retrieves all tracks from those albums, waiting between requests to avoid rate limits.
 * 7. Sorts all tracks in chronological order (by album release date and track number).
 * 8. Creates a new playlist in your Spotify account.
 * 9. Adds the sorted tracks to that playlist.
 * 10. Closes the Express server once processing is complete.
 *
 * Usage:
 *   node app.js "Label Name"
 */

// ------------------------
// Load Environment Variables
// ------------------------
require('dotenv').config();

// ------------------------
// Required Libraries
// ------------------------
const express = require('express');
const axios = require('axios');
// We'll use dynamic import for open since it is an ES module
const querystring = require('querystring');

// ------------------------
// Helper: Sleep Function to Wait a Specified Number of Milliseconds
// ------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ------------------------
// Configuration Section (using environment variables)
// ------------------------
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;  // e.g., http://localhost:8888/callback
const PORT = process.env.PORT || 8888;
const SCOPES = 'playlist-modify-private';

// ------------------------
// Read the Label Name from the Command Line
// ------------------------
const labelName = process.argv[2];
if (!labelName) {
  console.error('Error: Please provide a label name as a command-line argument.');
  console.error('Usage: node app.js "Label Name"');
  process.exit(1);
}
console.log(`Searching for albums with label: "${labelName}"`);

// ------------------------
// Express App Setup
// ------------------------
const app = express();

// Global variable to store the access token once received.
let accessToken = '';

// ------------------------
// Helper Function: Get User Profile
// ------------------------
async function getUserProfile(token) {
  try {
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching user profile:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// ------------------------
// Helper Function: Exchange Authorization Code for Access Token
// ------------------------
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
    console.error('Error obtaining access token:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// ------------------------
// Helper Function: Search for Albums by Label with Pagination
// ------------------------
async function searchAlbumsByLabel(label, token) {
  const searchURL = 'https://api.spotify.com/v1/search';
  // Query string formatted to search for a label
  const query = `label:"${label}"`;

  let albums = [];
  const limit = 50; // Maximum allowed per Spotify's search endpoint
  let offset = 0;
  let total = 0;

  // Fetch pages until we've retrieved all albums
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

      console.log(`Fetched ${albums.length} of ${total} albums so far...`);
      // Wait a short while before the next request to help avoid rate limits.
      await sleep(500);
    } catch (error) {
      console.error('Error searching for albums:', error.response ? error.response.data : error.message);
      throw error;
    }
  } while (offset < total);

  return albums;
}

// ------------------------
// Helper Function: Get Tracks from an Album
// ------------------------
async function getAlbumTracks(albumId, token) {
  const albumTracksURL = `https://api.spotify.com/v1/albums/${albumId}/tracks`;
  try {
    const response = await axios.get(albumTracksURL, {
      headers: { 'Authorization': `Bearer ${token}` },
      params: { market: 'US', limit: 50 } // Most albums have fewer than 50 tracks.
    });
    return response.data.items;
  } catch (error) {
    console.error(`Error fetching tracks for album ${albumId}:`, error.response ? error.response.data : error.message);
    throw error;
  }
}

// ------------------------
// Helper Function: Create a New Playlist
// ------------------------
async function createPlaylist(userId, token, label) {
  const createPlaylistURL = `https://api.spotify.com/v1/users/${userId}/playlists`;
  const playlistName = `Label Playlist: ${label} (Chronological)`;
  const data = {
    name: playlistName,
    public: false, // Create a private playlist
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
    console.error('Error creating playlist:', error.response ? error.response.data : error.message);
    throw error;
  }
}

// ------------------------
// Helper Function: Add Tracks to a Playlist (Batched if needed)
// ------------------------
async function addTracksToPlaylist(playlistId, trackURIs, token) {
  const addTracksURL = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  const BATCH_SIZE = 100; // Spotify's limit per request

  for (let i = 0; i < trackURIs.length; i += BATCH_SIZE) {
    const batch = trackURIs.slice(i, i + BATCH_SIZE);
    try {
      await axios.post(addTracksURL, { uris: batch }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
      });
      console.log(`Added batch ${Math.floor(i / BATCH_SIZE) + 1} of tracks to playlist.`);
      // Optional: Wait a moment between batch additions if needed
      await sleep(300);
    } catch (error) {
      console.error('Error adding tracks to playlist:', error.response ? error.response.data : error.message);
      throw error;
    }
  }
}

// ------------------------
// Express Route: /callback
// Handles Spotify's OAuth callback
// ------------------------
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    res.send('Error: No authorization code provided.');
    return;
  }

  try {
    // Exchange the authorization code for an access token.
    accessToken = await getAccessToken(code);
    console.log(`Access token received: ${accessToken}`);

    // 1. Get the current user's profile to retrieve the userId.
    const userProfile = await getUserProfile(accessToken);
    const userId = userProfile.id;
    console.log(`Logged in as: ${userProfile.display_name} (ID: ${userId})`);

    // 2. Search for albums using the label query with pagination.
    const albums = await searchAlbumsByLabel(labelName, accessToken);
    console.log(`Total albums found for label "${labelName}": ${albums.length}`);

    // 3. For each album, fetch its tracks and attach album release date info.
    let allTracks = [];
    for (const album of albums) {
      const albumTracks = await getAlbumTracks(album.id, accessToken);
      // Attach album release date and track number for sorting.
      albumTracks.forEach(track => {
        track.albumReleaseDate = album.release_date;
        track.albumTrackNumber = track.track_number;
      });
      allTracks = allTracks.concat(albumTracks);
      // Wait a short moment between album track requests.
      await sleep(200);
    }

    if (allTracks.length === 0) {
      res.send(`No tracks found for label "${labelName}".`);
      return;
    }

    // 4. Sort all tracks in chronological order (by album release date, then track number).
    allTracks.sort((a, b) => {
      const dateA = new Date(a.albumReleaseDate);
      const dateB = new Date(b.albumReleaseDate);
      if (dateA.getTime() === dateB.getTime()) {
        return a.albumTrackNumber - b.albumTrackNumber;
      }
      return dateA - dateB;
    });

    // 5. Extract track URIs.
    const trackURIs = allTracks.map(track => track.uri);
    console.log(`Total tracks to add: ${trackURIs.length}`);

    // 6. Create a new playlist in your account.
    const newPlaylist = await createPlaylist(userId, accessToken, labelName);
    console.log(`Created playlist "${newPlaylist.name}" with ID: ${newPlaylist.id}`);
    console.log(`Playlist URL: ${newPlaylist.external_urls.spotify}`);

    // 7. Add the sorted tracks to the new playlist.
    await addTracksToPlaylist(newPlaylist.id, trackURIs, accessToken);
    console.log('All tracks added to the playlist successfully.');

    // Notify the browser of completion.
    res.send(`Playlist created! Check your terminal for details. You can view your new playlist <a href="${newPlaylist.external_urls.spotify}" target="_blank">here</a>.`);

    // Close the server after a short delay to allow the response to send.
    setTimeout(() => {
      console.log('Closing server...');
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    }, 1000);
  } catch (error) {
    console.error('An error occurred during processing:', error.message);
    res.send('Error during processing. Check your terminal for details.');
  }
});

// ------------------------
// Start the Express Server & Initiate OAuth Flow
// ------------------------
const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);

  // Build Spotify's authorization URL with required parameters.
  const authURL = 'https://accounts.spotify.com/authorize?' + querystring.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: 'some-random-state', // Optionally generate a random state string for extra security.
  });

  console.log('Opening browser for Spotify authentication...');
  // Use dynamic import for the open module since it's an ES module.
  import('open')
    .then(openModule => {
      // openModule.default is the function to call.
      openModule.default(authURL);
    })
    .catch(error => {
      console.error('Error loading open module:', error);
    });
});