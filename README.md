# TÂCHES' Spotify Label Playlist Creator

## Prerequisites
- Node.js (v14 or later)
- A Spotify Developer account

## Setup Instructions

1. Clone the repository
```bash
git clone https://github.com/glittercowboy/spotify-playlist-creator.git
cd spotify-playlist-creator
```

2. Install dependencies
```bash
npm install
```

3. Set up Spotify Developer Credentials
- Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
- Create a new application
- Copy your Client ID and Client Secret
- Set the Redirect URI to `http://localhost:8888/callback`

4. Configure Environment Variables
- Copy `.env.example` to `.env`
- Fill in your Spotify Client ID, Client Secret, and Redirect URI

5. Run the Application
```bash
npm start
```
6. Open `http://localhost:8888` in your browser

7. Note: You MUST use the exact label name as it appears on a release on Spotify.

![App Screenshot](/screenshot.png)

## Features
- Create chronological playlists by record label
- Real-time progress tracking

## Contributing
Please read the `.env.example` file and set up your own Spotify Developer credentials.
