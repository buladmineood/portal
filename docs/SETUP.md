# Настройка на портала

Редът е важен. **Качете страниците в GitHub (стъпка 6) последни:** дотогава бутоните за вход няма да работят.

Нужни са: глобален администратор в Microsoft 365, Google акаунт и достъп до Cloudflare на buladmin.eu.

## 1. Вход с Microsoft

entra.microsoft.com → App registrations → New registration

- Име: `Портал БУЛАДМИН - Вход`
- Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
- Redirect URI (Web): `https://portal.buladmin.eu/api/auth/microsoft/callback`

Запишете **Application (client) ID** (това е `MS_CLIENT_ID`). От Certificates & secrets създайте нова тайна (това е `MS_CLIENT_SECRET`).

## 2. Вход с Google

console.cloud.google.com → нов проект → APIs & Services

- OAuth consent screen: External, само обхвати `openid`, `email`, `profile`. Публикувайте го в режим **In production**.
- Credentials → Create OAuth client ID → Web application
- Authorized redirect URI: `https://portal.buladmin.eu/api/auth/google/callback`

Запишете `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`.

## 3. Достъп до таблиците

Отделно приложение, което има достъп само до сайта `buladmin`.

1. New registration: име `Портал БУЛАДМИН - Данни`, **Single tenant**, без Redirect URI.
2. API permissions → Add → Microsoft Graph → **Application permissions** → `Sites.Selected` → **Grant admin consent**.
3. Създайте тайна. Запишете `GRAPH_CLIENT_ID` и `GRAPH_CLIENT_SECRET`.
4. Дайте достъп до сайта през [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer), влезли като администратор (нужно е съгласие за `Sites.FullControl.All`):

   Вземете ID на сайта:
   ```
   GET https://graph.microsoft.com/v1.0/sites/bulmaileu.sharepoint.com:/sites/buladmin?$select=id
   ```
   После:
   ```
   POST https://graph.microsoft.com/v1.0/sites/{ID-на-сайта}/permissions
   {
     "roles": ["manage"],
     "grantedToIdentities": [{ "application": { "id": "{GRAPH_CLIENT_ID}", "displayName": "Портал БУЛАДМИН - Данни" } }]
   }
   ```

## 4. Създаване на таблиците

Създайте файл `worker/.dev.vars` (той е в `.gitignore` и не се качва):

```
GRAPH_CLIENT_ID=...
GRAPH_CLIENT_SECRET=...
```

После:

```
cd worker
npm run provision -- --operator ваш-имейл@bulmail.eu --name "Вашето Име"
```

Така в сайта се създават четири таблици: `Портал - Клиенти`, `Портал - Заявки`, `Портал - История` и `Портал - Оператори`. Първият оператор се вписва автоматично. Скриптът може да се пуска повторно.

Щом таблиците са готови, намалете правата с PATCH към `.../sites/{ID-на-сайта}/permissions/{ID-на-правото}` и тяло `{ "roles": ["write"] }`. ID-то на правото се вижда с GET към `.../sites/{ID-на-сайта}/permissions`.

## 5. Качване на API-то в Cloudflare

```
cd worker
npx wrangler@4 login
npx wrangler@4 secret put SESSION_SECRET
npx wrangler@4 secret put GOOGLE_CLIENT_ID
npx wrangler@4 secret put GOOGLE_CLIENT_SECRET
npx wrangler@4 secret put MS_CLIENT_ID
npx wrangler@4 secret put MS_CLIENT_SECRET
npx wrangler@4 secret put GRAPH_CLIENT_ID
npx wrangler@4 secret put GRAPH_CLIENT_SECRET
npm run deploy
```

За `SESSION_SECRET` използвайте дълъг случаен низ, например резултата от `openssl rand -base64 48`.

Проверка: https://portal.buladmin.eu/api/meta трябва да върне JSON с услугите. Записът на `portal` в Cloudflare DNS трябва да остане **Proxied** (оранжев облак).

## 6. Качване на страниците

Качете кода в `main`. GitHub Pages публикува сам, а папките `worker/` и `docs/` не се публикуват.

## 7. Проверка от край до край

1. Регистрирайте се с Google като физическо лице и подайте заявка.
2. В друг браузър влезте със служебния Microsoft акаунт. Трябва да се отвори администрацията.
3. Сменете статуса и изпратете съобщение до клиента. Вижте ги в клиентския профил.
4. Отворете таблиците в SharePoint и проверете записите.

## Ежедневна работа

- **Нов оператор:** добавете ред в `Портал - Оператори` с имейла му за вход (UPN), име и `Активен = Да`.
- **Премахване на оператор:** сложете `Активен = Не`. Действа веднага.
- **Кой вижда таблиците в SharePoint:** всички с достъп до сайта `buladmin`. Дръжте в него само хора, които може да виждат клиентски данни.
- **Не преименувайте** таблиците и не изтривайте колони, защото порталът ги намира по тези имена.

## Локален преглед без акаунти

```
cd worker
npm run dev
```

Отворете http://localhost:8788/dev/login?as=client, `as=fresh` (нов клиент) или `as=operator`. Данните са демо и се губят при спиране. Тестове: `npm test`.
