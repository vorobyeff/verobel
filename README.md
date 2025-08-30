# YouTube Watch Time Tracker

Веб-сервис для отслеживания времени просмотра YouTube за последние 30 дней с авторизацией через Google.

## Возможности

- Авторизация через Google OAuth
- Получение данных о просмотренных видео с YouTube API
- Анализ времени просмотра за последние 30 дней
- Таблица с данными, готовая для экспорта в Excel
- Интерактивный график просмотров по дням

## Установка

### 1. Клонирование и установка зависимостей

```bash
git clone <repository-url>
cd youtube-watch-tracker
npm install
```

### 2. Настройка Google OAuth

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Создайте новый проект или выберите существующий
3. Включите YouTube Data API v3:
   - Перейдите в "APIs & Services" > "Library"
   - Найдите "YouTube Data API v3"
   - Нажмите "Enable"

4. Создайте OAuth 2.0 credentials:
   - Перейдите в "APIs & Services" > "Credentials"
   - Нажмите "Create Credentials" > "OAuth client ID"
   - Выберите "Web application"
   - Добавьте в "Authorized redirect URIs": `http://localhost:3000/auth/google/callback`

### 3. Конфигурация переменных среды

Отредактируйте файл `.env`:

```env
GOOGLE_CLIENT_ID=ваш_google_client_id
GOOGLE_CLIENT_SECRET=ваш_google_client_secret
SESSION_SECRET=случайная_строка_для_сессий
PORT=3000
REDIRECT_URI=http://localhost:3000/auth/google/callback
```

### 4. Запуск приложения

```bash
# Режим разработки
npm run dev

# Продакшн
npm start
```

Приложение будет доступно по адресу: `http://localhost:3000`

## Использование

1. Откройте `http://localhost:3000` в браузере
2. Нажмите "Войти через Google"
3. Разрешите доступ к вашему YouTube аккаунту
4. На странице Dashboard нажмите "Загрузить данные просмотров"
5. Просмотрите таблицу и график
6. Экспортируйте данные в Excel при необходимости

## Структура проекта

```
youtube-watch-tracker/
├── server.js              # Основной сервер Express
├── package.json           # Зависимости и скрипты
├── .env                   # Переменные окружения
├── README.md             # Документация
└── public/               # Статические файлы
    ├── index.html        # Главная страница
    └── dashboard.html    # Панель управления
```

## API Endpoints

- `GET /` - Главная страница
- `GET /auth/google` - Начало авторизации Google
- `GET /auth/google/callback` - Callback авторизации
- `GET /dashboard` - Панель управления (требует авторизации)
- `GET /api/watch-history` - API для получения статистики просмотров
- `GET /logout` - Выход из системы

## Технологии

- **Backend**: Node.js, Express, Passport.js, Google APIs
- **Frontend**: HTML, CSS, JavaScript, Chart.js
- **Авторизация**: Google OAuth 2.0
- **API**: YouTube Data API v3

## Примечания

- Приложение анализирует видео, опубликованные за последние 30 дней
- Время просмотра рассчитывается на основе длительности видео
- Данные группируются по дням для построения статистики
- Экспорт данных происходит в формате CSV, совместимом с Excel

## Troubleshooting

### Ошибка "Access blocked"
Убедитесь, что в настройках OAuth приложения добавлены правильные redirect URIs.

### Ошибка "API not enabled"
Проверьте, что YouTube Data API v3 включен в Google Cloud Console.

### Нет данных в статистике
YouTube API может возвращать ограниченные данные в зависимости от настроек приватности пользователя.