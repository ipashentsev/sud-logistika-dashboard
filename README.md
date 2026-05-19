# Дашборд логиста: участки 1-87

Готов к публикации как статический сайт (GitHub Pages).

## Структура
- `index.html` - точка входа (корень сайта)
- `styles.css`, `app.js` - стили и логика
- `data/` - CSV/JSON данные
- `src/` - рабочие исходники (можно оставить как черновик)

## Локальный запуск
```bash
cd /home/team-05/project-mirovye-sudi-logistika/data/dashboard
python3 -m http.server 8080
```
Открыть: `http://127.0.0.1:8080/`

## Публикация на GitHub Pages
1. Загрузить содержимое папки `dashboard` в корень репозитория.
2. В GitHub: `Settings -> Pages`.
3. Source: `Deploy from a branch`.
4. Branch: `main`, Folder: `/ (root)`.
5. Сайт будет доступен по URL вида:
   `https://<username>.github.io/<repo>/`

## Что умеет
- поиск по номеру/адресу;
- выбор участка в таблице и на карте;
- подсветка и центрирование точки;
- переход в Яндекс.Карты с маршрутом от м. Купчино.
