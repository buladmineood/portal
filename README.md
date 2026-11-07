# Портал БУЛАДМИН

Клиентски портал на https://portal.buladmin.eu/: регистрация на физически и юридически лица с Google или Microsoft акаунт, заявки за услуги и администрация за операторите.

| Част | Къде | Технология |
|---|---|---|
| Страници | корен на репото (`*.html`, `assets/`) | статичен HTML/JS на GitHub Pages |
| API и вход | `worker/` | Cloudflare Worker на `portal.buladmin.eu/api/*` |
| Данни | сайт `buladmin` в SharePoint | Microsoft Lists през Microsoft Graph |

Настройка и ежедневна работа: [docs/SETUP.md](docs/SETUP.md). Структурата на таблиците: [worker/src/schema.json](worker/src/schema.json).

```
cd worker
npm test      # тестове
npm run dev   # локален преглед с демо данни, http://localhost:8788
```
