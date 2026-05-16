# playground.rodion.pro

Каталог прототипов с деплоем под slug. Пример: проект со slug `tank` открывается на `https://playground.rodion.pro/tank/`.

## Возможности

- создавать и удалять проекты;
- хранить GitHub repo URL, branch, install/build/start команды и env;
- синхронизировать repo через Git;
- собирать статический билд и раздавать `outputDir` под slug;
- запускать динамический прототип и проксировать его под slug;
- смотреть deploy log из админки.

## Локальный запуск

```bash
npm install
cp .env.example .env
npm run dev
```

Открой `http://127.0.0.1:3000`.

## Продакшен

1. Скопируй `.env.example` в `/etc/playground.rodion.pro.env`.
2. Обязательно задай `PLAYGROUND_ADMIN_TOKEN`.
3. Настрой сервис из `ops/playground.service`.
4. Настрой nginx из `ops/nginx.conf`.
5. Выпусти сертификат Let's Encrypt для `playground.rodion.pro`.

В production systemd слушает `127.0.0.1:3357`, nginx проксирует публичный HTTPS на этот порт.

Шаблонный bootstrap лежит в `ops/bootstrap-server.sh`.

## Как устроены проекты

Данные каталога лежат в `data/projects.json`, рабочие директории проектов в `projects/<slug>/`.

Для `serveMode=static` приложение отдает `projects/<slug>/repo/<outputDir>` по адресу `/<slug>/`.

Для `serveMode=proxy` приложение запускает `startCommand` с `PORT=<port>` и проксирует `/<slug>/` на `127.0.0.1:<port>`.
