require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.REDIRECT_URI,
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/youtube.readonly']
}, (accessToken, refreshToken, profile, done) => {
  profile.accessToken = accessToken;
  profile.refreshToken = refreshToken;
  return done(null, profile);
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/auth/google');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/youtube.readonly']
}));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

app.get('/dashboard', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/watch-history', ensureAuthenticated, async (req, res) => {
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: req.user.accessToken
    });

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const watchHistory = [];
    let nextPageToken = null;

    do {
      const response = await youtube.search.list({
        part: 'id,snippet',
        forMine: true,
        type: 'video',
        order: 'date',
        maxResults: 50,
        pageToken: nextPageToken,
        publishedAfter: thirtyDaysAgo.toISOString()
      });

      if (response.data.items) {
        watchHistory.push(...response.data.items);
      }

      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    const processedData = await processWatchHistory(watchHistory, youtube);
    res.json(processedData);

  } catch (error) {
    console.error('Error fetching watch history:', error);
    res.status(500).json({ error: 'Failed to fetch watch history' });
  }
});

async function processWatchHistory(videos, youtube) {
  const dailyWatchTime = {};
  
  for (let i = 0; i < 30; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    dailyWatchTime[dateStr] = 0;
  }

  for (const video of videos) {
    try {
      const videoDetails = await youtube.videos.list({
        part: 'contentDetails,snippet',
        id: video.id.videoId
      });

      if (videoDetails.data.items && videoDetails.data.items[0]) {
        const duration = videoDetails.data.items[0].contentDetails.duration;
        const minutes = parseDuration(duration);
        
        const publishDate = new Date(video.snippet.publishedAt);
        const dateStr = publishDate.toISOString().split('T')[0];
        
        if (dailyWatchTime[dateStr] !== undefined) {
          dailyWatchTime[dateStr] += minutes;
        }
      }
    } catch (error) {
      console.error('Error processing video:', video.id.videoId, error);
    }
  }

  const tableData = Object.entries(dailyWatchTime)
    .sort(([a], [b]) => new Date(a) - new Date(b))
    .map(([date, minutes], index) => ({
      day: index + 1,
      date: date,
      minutes: Math.round(minutes)
    }));

  return {
    tableData,
    chartData: {
      labels: tableData.map(item => item.day),
      datasets: [{
        label: 'Минуты просмотра YouTube',
        data: tableData.map(item => item.minutes),
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        tension: 0.1
      }]
    }
  };
}

function parseDuration(duration) {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  const hours = (parseInt(match[1]) || 0);
  const minutes = (parseInt(match[2]) || 0);
  const seconds = (parseInt(match[3]) || 0);
  
  return hours * 60 + minutes + seconds / 60;
}

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) { 
      return next(err); 
    }
    res.redirect('/');
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});