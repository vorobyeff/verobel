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
  scope: [
    'profile', 
    'email', 
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/activity'
  ]
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
  scope: [
    'profile', 
    'email', 
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/activity'
  ]
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

// Демо режим без авторизации
app.get('/demo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Получение истории просмотра пользователя
app.get('/api/watch-history', async (req, res) => {
    // Проверяем авторизацию - если не авторизован, возвращаем демо данные
    if (!req.isAuthenticated()) {
        const demoData = generateDemoWatchHistory();
        return res.json({
            ...demoData,
            isDemo: true,
            message: 'Демо данные - YouTube API не предоставляет полную историю просмотров'
        });
    }

    try {
        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({
            access_token: req.user.accessToken
        });

        // Попробуем получить данные из нескольких источников
        const watchData = [];
        const dailyStats = {};

        try {
            // 1. Попробуем получить данные из YouTube API
            const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
            
            // Получаем информацию о пользователе
            const channelResponse = await youtube.channels.list({
                part: 'contentDetails,statistics,snippet',
                mine: true
            });

            let userChannelInfo = null;
            if (channelResponse.data.items && channelResponse.data.items.length > 0) {
                userChannelInfo = channelResponse.data.items[0];
                console.log(`Найден канал пользователя: ${userChannelInfo.snippet.title}`);
                
                // Получаем загруженные видео пользователя как альтернативу истории
                const uploadsPlaylistId = userChannelInfo.contentDetails?.relatedPlaylists?.uploads;
                if (uploadsPlaylistId) {
                    const uploadsResponse = await youtube.playlistItems.list({
                        part: 'snippet',
                        playlistId: uploadsPlaylistId,
                        maxResults: 50
                    });

                    console.log(`Найдено ${uploadsResponse.data.items?.length || 0} загруженных видео`);

                    for (const item of uploadsResponse.data.items || []) {
                        const videoId = item.snippet.resourceId?.videoId;
                        if (videoId) {
                            try {
                                const videoResponse = await youtube.videos.list({
                                    part: 'contentDetails,snippet,statistics',
                                    id: videoId
                                });

                                if (videoResponse.data.items && videoResponse.data.items.length > 0) {
                                    const video = videoResponse.data.items[0];
                                    const duration = parseDuration(video.contentDetails.duration);
                                    const publishedAt = new Date(video.snippet.publishedAt);
                                    const date = publishedAt.toISOString().split('T')[0];
                                    
                                    watchData.push({
                                        title: video.snippet.title,
                                        watchedAt: video.snippet.publishedAt,
                                        duration: duration,
                                        videoId: videoId,
                                        channelTitle: video.snippet.channelTitle,
                                        isOwn: true,
                                        viewCount: parseInt(video.statistics?.viewCount || 0)
                                    });

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

                // Пытаемся получить реальную историю просмотров через разные методы
                try {
                    // Метод 1: Попытка получить историю просмотров через watchHistory плейлист
                    const watchHistoryPlaylistId = userChannelInfo.contentDetails?.relatedPlaylists?.watchHistory;
                    
                    if (watchHistoryPlaylistId) {
                        console.log('Пытаемся получить историю просмотров из плейлиста:', watchHistoryPlaylistId);
                        
                        try {
                            const historyResponse = await youtube.playlistItems.list({
                                part: 'snippet,contentDetails',
                                playlistId: watchHistoryPlaylistId,
                                maxResults: 50
                            });

                            console.log(`Плейлист истории: найдено ${historyResponse.data.items?.length || 0} элементов`);

                            for (const item of historyResponse.data.items || []) {
                                const videoId = item.snippet.resourceId?.videoId;
                                if (videoId) {
                                    try {
                                        const videoResponse = await youtube.videos.list({
                                            part: 'contentDetails,snippet',
                                            id: videoId
                                        });

                                        if (videoResponse.data.items && videoResponse.data.items.length > 0) {
                                            const video = videoResponse.data.items[0];
                                            const duration = parseDuration(video.contentDetails.duration);
                                            const watchedAt = new Date(item.snippet.publishedAt);
                                            const date = watchedAt.toISOString().split('T')[0];
                                            
                                            watchData.push({
                                                title: video.snippet.title,
                                                watchedAt: item.snippet.publishedAt,
                                                duration: duration,
                                                videoId: videoId,
                                                channelTitle: video.snippet.channelTitle,
                                                isHistory: true
                                            });

                                            if (!dailyStats[date]) {
                                                dailyStats[date] = { totalMinutes: 0, videoCount: 0 };
                                            }
                                            dailyStats[date].totalMinutes += duration;
                                            dailyStats[date].videoCount += 1;
                                        }
                                    } catch (videoError) {
                                        console.error('Ошибка при получении видео из истории:', videoError);
                                    }
                                }
                            }
                        } catch (historyError) {
                            console.log('Не удалось получить историю просмотров:', historyError.message);
                        }
                    }
                    
                    // Метод 2: Попытка через My Activity API (требует дополнительных разрешений)
                    try {
                        // Этот метод пока недоступен через стандартный YouTube API
                        console.log('My Activity API пока не реализован');
                    } catch (activityError) {
                        console.log('My Activity API недоступен:', activityError.message);
                    }
                    
                } catch (historyError) {
                    console.log('Не удалось получить историю просмотров:', historyError.message);
                }
            }

        } catch (apiError) {
            console.error('Ошибка при работе с YouTube API:', apiError);
        }

        // Если получили хотя бы немного реальных данных, дополним их демо данными
        if (watchData.length > 0) {
            console.log(`Получили ${watchData.length} реальных видео, дополняем демо данными`);
            
            // Генерируем дополнительные демо данные для заполнения пробелов
            const additionalDemoData = generateDemoWatchHistory();
            
            // Смешиваем реальные и демо данные
            const mixedData = [...watchData];
            
            // Добавляем часть демо данных, помечая их
            additionalDemoData.watchHistory.slice(0, Math.max(0, 50 - watchData.length)).forEach(demoVideo => {
                mixedData.push({
                    ...demoVideo,
                    isDemo: true
                });
            });

            // Пересчитываем статистику
            const mixedStats = { ...dailyStats };
            Object.keys(additionalDemoData.dailyStats).forEach(date => {
                if (!mixedStats[date]) {
                    mixedStats[date] = additionalDemoData.dailyStats[date];
                } else {
                    mixedStats[date].totalMinutes += additionalDemoData.dailyStats[date].totalMinutes;
                    mixedStats[date].videoCount += additionalDemoData.dailyStats[date].videoCount;
                }
            });

            res.json({
                watchHistory: mixedData,
                dailyStats: mixedStats,
                isMixed: true,
                realDataCount: watchData.length,
                message: 'Смешанные данные: часть реальных, часть демо (YouTube API ограничивает доступ к истории просмотров)'
            });
        } else {
            console.log('Реальных данных не получено, отправляем демо данные с объяснением');
            const demoData = generateDemoWatchHistory();
            res.json({
                ...demoData,
                isDemo: true,
                message: 'Демо данные - YouTube API не предоставляет доступ к истории просмотров по соображениям конфиденциальности. Для получения реальных данных экспортируйте их через Google Takeout.'
            });
        }

    } catch (error) {
        console.error('Ошибка при получении истории просмотра:', error);
        
        const demoData = generateDemoWatchHistory();
        res.json({
            ...demoData,
            isDemo: true,
            error: error.message,
            message: 'Демо данные из-за ошибки API'
        });
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