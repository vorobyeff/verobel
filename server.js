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

// Получение истории просмотра пользователя
app.get('/api/watch-history', ensureAuthenticated, async (req, res) => {
    try {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({
            access_token: req.user.accessToken
        });

        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        
        // Получаем историю просмотра пользователя
        const historyResponse = await youtube.activities.list({
            part: 'snippet,contentDetails',
            mine: true,
            maxResults: 50,
            publishedAfter: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() // 30 дней назад
        });

        const watchData = [];
        const dailyStats = {};

        for (const activity of historyResponse.data.items) {
            // Фильтруем только действия просмотра видео
            if (activity.snippet.type === 'upload' || 
                (activity.contentDetails && activity.contentDetails.upload)) {
                
                const date = new Date(activity.snippet.publishedAt).toISOString().split('T')[0];
                
                // Получаем информацию о видео для определения длительности
                const videoId = activity.contentDetails?.upload?.videoId;
                if (videoId) {
                    try {
                        const videoResponse = await youtube.videos.list({
                            part: 'contentDetails,snippet',
                            id: videoId
                        });

                        if (videoResponse.data.items && videoResponse.data.items.length > 0) {
                            const video = videoResponse.data.items[0];
                            const duration = parseDuration(video.contentDetails.duration);
                            
                            watchData.push({
                                title: video.snippet.title,
                                watchedAt: activity.snippet.publishedAt,
                                duration: duration,
                                videoId: videoId,
                                channelTitle: video.snippet.channelTitle
                            });

                            // Агрегируем по дням
                            if (!dailyStats[date]) {
                                dailyStats[date] = { totalMinutes: 0, videoCount: 0 };
                            }
                            dailyStats[date].totalMinutes += duration;
                            dailyStats[date].videoCount += 1;
                        }
                    } catch (videoError) {
                        console.error('Ошибка при получении информации о видео:', videoError);
                    }
                }
            }
        }

        // Если история активности недоступна, используем альтернативный подход
        if (watchData.length === 0) {
            // Получаем плейлист "История просмотров" пользователя
            const channelResponse = await youtube.channels.list({
                part: 'contentDetails',
                mine: true
            });

            if (channelResponse.data.items && channelResponse.data.items.length > 0) {
                const watchHistoryPlaylistId = channelResponse.data.items[0].contentDetails?.relatedPlaylists?.watchHistory;
                
                if (watchHistoryPlaylistId) {
                    try {
                        const historyPlaylistResponse = await youtube.playlistItems.list({
                            part: 'snippet',
                            playlistId: watchHistoryPlaylistId,
                            maxResults: 50
                        });

                        for (const item of historyPlaylistResponse.data.items) {
                            const watchedAt = new Date(item.snippet.publishedAt);
                            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                            
                            if (watchedAt >= thirtyDaysAgo) {
                                const videoId = item.snippet.resourceId?.videoId;
                                if (videoId) {
                                    const videoResponse = await youtube.videos.list({
                                        part: 'contentDetails,snippet',
                                        id: videoId
                                    });

                                    if (videoResponse.data.items && videoResponse.data.items.length > 0) {
                                        const video = videoResponse.data.items[0];
                                        const duration = parseDuration(video.contentDetails.duration);
                                        const date = watchedAt.toISOString().split('T')[0];
                                        
                                        watchData.push({
                                            title: video.snippet.title,
                                            watchedAt: item.snippet.publishedAt,
                                            duration: duration,
                                            videoId: videoId,
                                            channelTitle: video.snippet.channelTitle
                                        });

                                        if (!dailyStats[date]) {
                                            dailyStats[date] = { totalMinutes: 0, videoCount: 0 };
                                        }
                                        dailyStats[date].totalMinutes += duration;
                                        dailyStats[date].videoCount += 1;
                                    }
                                }
                            }
                        }
                    } catch (playlistError) {
                        console.log('История просмотров недоступна через API');
                    }
                }
            }
        }

        // Если все еще нет данных, создаем демо данные
        if (watchData.length === 0) {
            const demoData = generateDemoWatchHistory();
            res.json(demoData);
        } else {
            res.json({ watchHistory: watchData, dailyStats });
        }

    } catch (error) {
        console.error('Ошибка при получении истории просмотра:', error);
        
        // В случае ошибки отправляем демо данные
        const demoData = generateDemoWatchHistory();
        res.json(demoData);
    }
});

// Генерация демо данных истории просмотра
function generateDemoWatchHistory() {
    const watchHistory = [];
    const dailyStats = {};
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const sampleVideos = [
        { title: "JavaScript Tutorial - Полный курс", duration: 45, channel: "CodeSchool" },
        { title: "React Hooks Explained", duration: 28, channel: "TechTalks" },
        { title: "Node.js Best Practices", duration: 35, channel: "WebDev Pro" },
        { title: "CSS Grid Layout Guide", duration: 22, channel: "DesignMaster" },
        { title: "API Design Patterns", duration: 40, channel: "DevTips" },
        { title: "Database Optimization Tips", duration: 33, channel: "DataGuru" },
        { title: "Machine Learning Basics", duration: 55, channel: "AI Academy" },
        { title: "Python for Beginners", duration: 42, channel: "CodePython" },
        { title: "Docker Complete Guide", duration: 38, channel: "DevOps Hub" },
        { title: "Git Workflow Strategies", duration: 25, channel: "GitMaster" }
    ];

    for (let i = 0; i < 30; i++) {
        const date = new Date(thirtyDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        
        // Случайное количество просмотров в день (0-5)
        const videosPerDay = Math.floor(Math.random() * 6);
        let dailyMinutes = 0;
        
        for (let j = 0; j < videosPerDay; j++) {
            const randomVideo = sampleVideos[Math.floor(Math.random() * sampleVideos.length)];
            const watchTime = new Date(date.getTime() + Math.random() * 24 * 60 * 60 * 1000);
            
            watchHistory.push({
                title: randomVideo.title,
                watchedAt: watchTime.toISOString(),
                duration: randomVideo.duration,
                videoId: `demo_${i}_${j}`,
                channelTitle: randomVideo.channel
            });
            
            dailyMinutes += randomVideo.duration;
        }
        
        if (dailyMinutes > 0) {
            dailyStats[dateStr] = {
                totalMinutes: dailyMinutes,
                videoCount: videosPerDay
            };
        }
    }

    return { watchHistory, dailyStats };
}

// Вспомогательная функция для парсинга ISO 8601 duration
function parseDuration(duration) {
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    const hours = (parseInt(match[1]) || 0);
    const minutes = (parseInt(match[2]) || 0);
    const seconds = (parseInt(match[3]) || 0);
    
    return hours * 60 + minutes + Math.round(seconds / 60);
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