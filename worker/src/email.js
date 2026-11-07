// Шаблон за автоматичните имейли: таблици и вградени стилове, за да изглеждат еднакво в Outlook, Gmail и на телефон.
// Всички стойности минават през esc(): част от тях идват от клиенти и оператори.

export const STATUS_FLOW = ['Нова', 'Уточняване', 'Подготвена', 'Подадена', 'Проследява се', 'Получена'];

const C = {
  navy: '#10294c', gold: '#b5862a', goldSoft: '#e0b65e', ink: '#10294c', muted: '#4a5a73',
  line: '#dcd7cb', page: '#f3efe6', paper: '#ffffff', tint: '#faf7f0', red: '#a3211a', redBg: '#fbeeed',
};
const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

function statusBlock(status) {
  if (status === 'Отказана') {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-collapse:separate;">
      <tr><td style="padding:14px 16px;background:${C.redBg};border:1px solid #e7bdb9;border-radius:8px;font:600 15px/1.4 ${FONT};color:${C.red};">
        Статус: Отказана
      </td></tr></table>`;
  }
  // Само кръгчета без надписи под тях, за да се събират и на тесен телефон. Етапът е изписан над тях.
  const current = STATUS_FLOW.indexOf(status);
  const next = STATUS_FLOW[current + 1];
  const cells = STATUS_FLOW.map((step, i) => {
    const done = i < current;
    const now = i === current;
    const circleBg = done ? C.goldSoft : now ? C.navy : C.paper;
    const circleFg = done ? C.navy : now ? '#ffffff' : C.muted;
    const border = done ? C.goldSoft : now ? C.navy : C.line;
    const mark = done ? '&#10003;' : String(i + 1);
    const line = i < STATUS_FLOW.length - 1
      ? `<td width="20%" style="width:20%;padding:0 4px;"><div style="height:3px;background:${i < current ? C.goldSoft : C.line};font-size:0;line-height:0;">&nbsp;</div></td>`
      : '';
    return `<td width="26" align="center" valign="middle" title="${esc(step)}" style="width:26px;">
        <div style="width:24px;height:24px;border-radius:13px;background:${circleBg};border:1px solid ${border};font:700 12px/24px ${FONT};color:${circleFg};text-align:center;">${mark}</div>
      </td>${line}`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;border:1px solid ${C.line};border-radius:8px;border-collapse:separate;background:${C.tint};">
      <tr><td style="padding:14px 16px 10px;">
        <div style="font:13px/1.4 ${FONT};color:${C.muted};">Етап ${current + 1} от ${STATUS_FLOW.length}</div>
        <div style="font:700 18px/1.3 ${FONT};color:${C.ink};">${esc(status)}</div>
      </td></tr>
      <tr><td style="padding:0 16px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
      </td></tr>
      <tr><td style="padding:0 16px 14px;font:13px/1.5 ${FONT};color:${C.muted};">
        ${next ? `Следващ етап: <strong style="color:${C.ink};">${esc(next)}</strong>` : '<strong style="color:#1d6b45;">Заявката е изпълнена.</strong>'}
      </td></tr>
    </table>`;
}

function detailsBlock(rows) {
  const body = rows.map(([label, value], i) => `<tr>
    <td style="padding:10px 14px;${i ? `border-top:1px solid ${C.line};` : ''}font:13px/1.4 ${FONT};color:${C.muted};width:38%;">${esc(label)}</td>
    <td style="padding:10px 14px;${i ? `border-top:1px solid ${C.line};` : ''}font:600 14px/1.4 ${FONT};color:${C.ink};">${esc(value)}</td>
  </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid ${C.line};border-radius:8px;border-collapse:separate;background:${C.tint};">${body}</table>`;
}

function actionBlock({ label, url }) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr>
    <td bgcolor="${C.navy}" style="border-radius:8px;">
      <a href="${esc(url)}" style="display:inline-block;padding:14px 26px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>
    </td></tr></table>
    <p style="margin:0 0 24px;font:12px/1.5 ${FONT};color:${C.muted};">Ако бутонът не работи, копирайте този адрес в браузъра:<br><a href="${esc(url)}" style="color:${C.navy};word-break:break-all;">${esc(url)}</a></p>`;
}

function codeBlock(code) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 24px;"><tr>
    <td style="padding:16px 24px;background:${C.tint};border:1px solid ${C.line};border-radius:8px;font:700 30px/1 Consolas, 'Courier New', monospace;letter-spacing:8px;color:${C.navy};">${esc(code)}</td>
  </tr></table>`;
}

// Връща HTML и текстова версия на едно и също съобщение.
export function renderEmail({ origin, preheader, title, paragraphs = [], status, details = [], action, code, note }) {
  const p = (text) => `<p style="margin:0 0 16px;font:15px/1.6 ${FONT};color:${C.ink};">${esc(text)}</p>`;
  const html = `<!doctype html>
<html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader || title)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};"><tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.paper};border:1px solid ${C.line};border-radius:12px;border-collapse:separate;overflow:hidden;">
    <tr><td style="padding:18px 28px;background:${C.navy};border-radius:12px 12px 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding-right:12px;"><img src="${esc(origin)}/assets/img/apple-touch-icon.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:8px;background:#ffffff;"></td>
        <td style="font:600 18px/1 ${FONT};letter-spacing:2px;color:#ffffff;">БУЛ<span style="color:${C.goldSoft};">АДМИН</span></td>
      </tr></table>
    </td></tr>
    <tr><td style="height:4px;background:${C.gold};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:32px 28px 8px;">
      <h1 style="margin:0 0 18px;font:700 22px/1.3 ${FONT};color:${C.ink};">${esc(title)}</h1>
      ${paragraphs.map(p).join('')}
      ${status ? statusBlock(status) : ''}
      ${code ? codeBlock(code) : ''}
      ${details.length ? detailsBlock(details) : ''}
      ${action ? actionBlock(action) : ''}
      ${note ? `<p style="margin:0 0 24px;font:13px/1.6 ${FONT};color:${C.muted};">${esc(note)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:20px 28px 24px;border-top:1px solid ${C.line};background:${C.tint};border-radius:0 0 12px 12px;">
      <p style="margin:0 0 6px;font:600 13px/1.5 ${FONT};color:${C.ink};">БУЛАДМИН · Портал за клиенти</p>
      <p style="margin:0;font:12px/1.6 ${FONT};color:${C.muted};">Това съобщение е изпратено автоматично. Моля, не отговаряйте на него. Въпроси: <a href="mailto:call@buladmin.eu" style="color:${C.navy};">call@buladmin.eu</a>.<br>Никога няма да Ви поискаме парола или код по имейл или телефон.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    title,
    '',
    ...paragraphs.flatMap((t) => [t, '']),
    ...(status ? [`Статус: ${status}${STATUS_FLOW.includes(status) ? ` (етап ${STATUS_FLOW.indexOf(status) + 1} от ${STATUS_FLOW.length})` : ''}`, ''] : []),
    ...(code ? [`Код: ${code}`, ''] : []),
    ...details.map(([label, value]) => `${label}: ${value}`),
    ...(details.length ? [''] : []),
    ...(action ? [`${action.label}: ${action.url}`, ''] : []),
    ...(note ? [note, ''] : []),
    'БУЛАДМИН · Портал за клиенти',
    origin,
    'Това съобщение е изпратено автоматично. Моля, не отговаряйте на него.',
  ].join('\n');
  return { html, text };
}
