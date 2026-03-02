# YetAnotherSSHClient

YetAnotherSSHClient — лёгкий SSH-клиент на ReactJS для быстрого подключения к серверам без лишней сложности. Подходит для повседневного администрирования и работы с несколькими хостами.

🚀 Возможности
- Поддержка вкладок
- Добавление сервера в избранное
- Аутентификация по ключу
- Множество тем оформления
- Гибкая настройка шрифтов

🖼️ Скриншоты

> ⚠️ Рекомендую использовать шрифт: [JetBrains Mono Regular](https://www.jetbrains.com/lp/mono/)

### 🌙 Тёмная тема

![Main view](https://github.com/megoRU/YetAnotherSSHClient/blob/main/images/GruvboxDark.png?raw=true)

### 🌾 Gruvbox Light

![Main view](https://github.com/megoRU/YetAnotherSSHClient/blob/main/images/GruvboxLight.png?raw=true)

🧩 Используемые технологии
- React
- Electron

⚙️ Конфигурация
Файл настроек хранится локально:
- Windows: `C:\Users\<имя_пользователя>\.minissh_config.json`
- Linux / macOS: `~/.minissh_config.json`

⚠️ **Примечание для macOS**

- Если при запуске появляется ошибка **«Приложение повреждено»**, выполните в терминале команду:
  ```bash
  sudo xattr -cr /Applications/YetAnotherSSHClient.app
  ```
  Или, если не помогает:
  ```bash
  chmod +x /Applications/YetAnotherSSHClient.app/Contents/MacOS/YetAnotherSSHClient
  ```
- Для диагностики причин отказа в запуске, попробуйте запустить приложение напрямую через Терминал:
  ```bash
  /Applications/YetAnotherSSHClient.app/Contents/MacOS/YetAnotherSSHClient
  ```
- В крайнем случае, если приложение всё равно не открывается, попробуйте переподписать его локально:
  ```bash
  codesign --force --deep --sign - /Applications/YetAnotherSSHClient.app
  ```
- После первого запуска может появиться предупреждение о неподтверждённом разработчике — нажмите **Готово**.
- Откройте **Системные настройки** → **Конфиденциальность и безопасность**.
- Внизу окна появится сообщение о заблокированном приложении — нажмите **Всё равно открыть**.

## 📄 License

Copyright © 2026 megoRU

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

For full license text, see [GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.en.html).
