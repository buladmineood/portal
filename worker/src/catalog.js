// Каталогът следва услугите, публикувани на https://www.buladmin.eu/
// requiresIdentity: при заявка е задължително ЕГН/ЛНЧ на лицето или на представляващия на фирмата.
// companyOnly: категорията е само за юридически лица.
export const CATALOG = [
  { name: 'Документи', requiresIdentity: true, services: ['Искания и заявления', 'Декларации и изявления', 'Удостоверения и справки', 'Заверени копия'] },
  { name: 'Имоти', requiresIdentity: true, services: ['Кадастрални данни', 'Имотни регистри', 'Местни данъци и такси', 'Устройство на територията и строителство'] },
  { name: 'Наследства', requiresIdentity: true, services: ['Събиране на документи', 'Справки и удостоверения', 'Наследствени имоти', 'Наследствени превозни средства'] },
  { name: 'Представителство', requiresIdentity: true, services: ['Административни органи', 'Държавни и общински агенции', 'Организации и институции', 'Регистри в България и чужбина'] },
  { name: 'Превозни средства', requiresIdentity: true, services: ['Първоначална регистрация', 'Промяна на данни', 'Прекратяване на регистрация', 'Друго движимо имущество'] },
  { name: 'Електронни услуги', requiresIdentity: false, services: ['Електронни платформи', 'Портали', 'Регистри', 'Информационни системи'] },
  { name: 'Регистрации и разрешения', requiresIdentity: true, services: ['Вписвания', 'Регистрации', 'Разрешения', 'Лицензи и сертификати'] },
  { name: 'Обслужване на фирми', requiresIdentity: false, services: ['Управление на документооборот', 'Търговско представителство', 'Посредничество и комисионна дейност', 'Информационни и консултантски услуги'] },
  {
    name: 'Фирмени декларации', requiresIdentity: false, companyOnly: true,
    services: [
      'Декларация по чл. 7а за доставчик на медийни услуги',
      'Декларация по чл. 7б за разпространител на печатни издания',
      'Декларация СПБ-2 за сметка в чужбина (БНБ)',
    ],
  },
  {
    name: 'Търговски регистър', requiresIdentity: false,
    services: ['Регистрация на ООД или ЕООД', 'Промени по партидата на ООД или ЕООД'],
  },
];

export const STATUSES = ['Нова', 'Уточняване', 'Подготвена', 'Подадена', 'Проследява се', 'Получена', 'Отказана'];
export const PERSON_TYPES = { individual: 'Физическо лице', company: 'Юридическо лице' };
export const CONSENT_VERSION = '2026-11-07';

// Права по Регламент (ЕС) 2016/679 (GDPR) и Закона за защита на личните данни.
export const PRIVACY_RIGHTS = [
  'Достъп до данните (чл. 15)',
  'Поправка (чл. 16)',
  'Изтриване (чл. 17)',
  'Ограничаване на обработването (чл. 18)',
  'Преносимост (чл. 20)',
  'Възражение (чл. 21)',
  'Оттегляне на съгласие (чл. 7, пар. 3)',
  'Друго',
];
export const PRIVACY_STATUSES = ['Подадено', 'В обработка', 'Удължен срок', 'Изпълнено', 'Отказано'];

// --- Декларации по ЗЗДПДПОРДМУ (Закон за задължителното депозиране на печатни и други произведения
// и за обявяване на разпространителите и доставчиците на медийни услуги) към Министерството на културата.
// Полетата следват официалните образци Deklaracia7a-MK.pdf и Deklaracia7b-MK.pdf.
//
// Видове полета: text (по подразбиране), email, egn, eik, date, amount, percent, currency, yesno, choice.
// pattern/patternError: допълнителна проверка на текстово поле.
// prefill: от кое поле на профила да се попълни първоначално.
// showIf: { field, is } или { field, not }: полето се показва (и проверява) само при това условие в същия ред.
// Секция с list: true е таблица с редове; с optional редовете могат да се заменят с „Неприложимо“.
// thirdParties: формата съдържа лични данни на други хора и клиентът потвърждава, че ги е информирал.
const PERSON_FIELDS = [
  { name: 'fullName', label: 'Три имена', required: true, max: 150, wide: true },
  { name: 'egn', label: 'ЕГН или ЛНЧ', kind: 'egn', required: true },
  { name: 'citizenship', label: 'Гражданство', required: true, max: 60, initial: 'българско' },
  { name: 'idNumber', label: 'Лична карта №', required: true, max: 20 },
  { name: 'idIssuedOn', label: 'Издадена на', kind: 'date', required: true },
  { name: 'idIssuedBy', label: 'Издадена от', required: true, max: 100, wide: true, placeholder: 'Например: МВР – София' },
  { name: 'address', label: 'Постоянен адрес', required: true, max: 200, wide: true },
  { name: 'publicOffice', label: 'Заема ли публична длъжност?', kind: 'yesno', required: true },
  { name: 'publicOfficeDetails', label: 'Публична длъжност и организация', max: 200, wide: true, required: true, showIf: { field: 'publicOffice', is: 'Да' } },
];

const COMPANY_SECTION = {
  name: 'company',
  label: 'Данни за дружеството',
  hint: 'Наименованието и ЕИК се вземат от профила Ви.',
  fields: [
    { name: 'notifyEmail', label: 'Имейл за уведомления', kind: 'email', required: true, max: 200, wide: true, hint: 'на него министерството ще съобщи, когато вземе декларацията' },
    { name: 'website', label: 'Уебсайт', max: 200, wide: true, hint: 'ако има', placeholder: 'https://' },
    { name: 'isPublic', label: 'Дружеството е публично', kind: 'yesno', required: true },
    { name: 'supervisor', label: 'Надзорна институция на публичното дружество', max: 200, wide: true, required: true, showIf: { field: 'isPublic', is: 'Да' } },
  ],
};

const PEOPLE_SECTIONS = [
  { name: 'owners', label: 'Действителни собственици', list: true, min: 1, item: 'собственик', fields: PERSON_FIELDS },
  { name: 'representatives', label: 'Представляващи дружеството', list: true, min: 1, item: 'представляващ', fields: PERSON_FIELDS },
  {
    name: 'controllers', label: 'Лица с фактически контрол', list: true, item: 'лице',
    optional: 'Неприложимо: контролът се упражнява от действителния собственик', fields: PERSON_FIELDS,
  },
];

export const FORMS = {
  'media-7a': {
    title: 'Декларация по чл. 7а ЗЗДПДПОРДМУ за доставчик на медийни услуги',
    thirdParties: true,
    sections: [
      COMPANY_SECTION,
      {
        name: 'mediaServices', label: 'Медийни услуги', list: true, min: 1, item: 'медийна услуга',
        fields: [
          { name: 'name', label: 'Име на медийната услуга', required: true, max: 200, wide: true },
          { name: 'type', label: 'Тип', kind: 'choice', required: true, options: ['Радио', 'Телевизия', 'Печатна медия', 'Онлайн новинарско издание'] },
        ],
      },
      ...PEOPLE_SECTIONS,
      {
        name: 'financing', label: 'Получено финансиране по чл. 7а, ал. 3', list: true, item: 'финансиране',
        optional: 'Неприложимо: дружеството няма финансиране по чл. 7а, ал. 3',
        fields: [
          { name: 'amount', label: 'Размер на финансирането', kind: 'amount', required: true },
          { name: 'basis', label: 'Основание', required: true, max: 300, wide: true, hint: 'предмет на договор или друго основание' },
          { name: 'source', label: 'Източник', required: true, max: 200, wide: true, hint: 'три имена на физическо лице или наименование и ЕИК на юридическо лице' },
        ],
      },
      {
        name: 'contracts', label: 'Договори по чл. 7а, ал. 4', list: true, item: 'договор',
        optional: 'Неприложимо: дружеството няма договори по чл. 7а, ал. 4',
        fields: [
          { name: 'amount', label: 'Стойност на договора', kind: 'amount', required: true },
          { name: 'basis', label: 'Дата и предмет на договора', required: true, max: 300, wide: true },
          { name: 'contractor', label: 'Възложител', required: true, max: 200, wide: true, hint: 'три имена на физическо лице или наименование и ЕИК на юридическо лице' },
        ],
      },
    ],
  },
  'print-7b': {
    title: 'Декларация по чл. 7б ЗЗДПДПОРДМУ за разпространител на периодични печатни издания',
    thirdParties: true,
    sections: [
      COMPANY_SECTION,
      ...PEOPLE_SECTIONS,
      {
        name: 'outlets', label: 'Обекти, в които дружеството разпространява печатни издания', list: true, item: 'обект',
        optional: 'Неприложимо: дружеството няма обекти',
        fields: [
          { name: 'name', label: 'Наименование на обекта', required: true, max: 200 },
          { name: 'address', label: 'Адрес на обекта', required: true, max: 200 },
        ],
      },
    ],
  },
  // Образец по чл. 6, ал. 1, т. 2 от Наредба № 27 на БНБ. Подава се до 15 работни дни от откриването на сметката.
  'bnb-spb2': {
    title: 'Декларация – форма СПБ-2 за сметка в чужбина (Наредба № 27 на БНБ)',
    intro: 'Подава се до 15 работни дни от откриването на сметката. За всяка сметка се подава отделна декларация. При промяна или закриване на вече декларирана сметка изберете „Коригираща“.',
    summary: [{ section: 'account', fields: ['bankName', 'country', 'currency', 'openedOn'] }],
    sections: [
      {
        name: 'declaration', label: 'Тип на декларацията',
        fields: [
          { name: 'type', label: 'Тип', kind: 'choice', required: true, options: ['Първоначална', 'Коригираща'] },
          { name: 'bnbNumber', label: 'Регистрационен № на БНБ', required: true, max: 40, showIf: { field: 'type', is: 'Коригираща' } },
          { name: 'changedOn', label: 'Дата на промяната', kind: 'date', required: true, showIf: { field: 'type', is: 'Коригираща' } },
        ],
      },
      {
        name: 'holder', label: '1. Местно лице – титуляр на сметката',
        hint: 'Наименованието и ЕИК се вземат от профила Ви.',
        fields: [
          { name: 'knownToBnb', label: 'Дружеството вече е подавало декларация или отчетна форма в БНБ и данните му не са променени', kind: 'yesno', required: true, wide: true },
          { name: 'city', label: 'Населено място (седалище)', required: true, max: 100, prefill: 'city', showIf: { field: 'knownToBnb', is: 'Не' } },
          {
            name: 'postalCode', label: 'Пощенски код (седалище)', required: true, max: 4, prefill: 'postalCode',
            pattern: '^\\d{4}$', patternError: 'Пощенският код е 4 цифри.', showIf: { field: 'knownToBnb', is: 'Не' },
          },
          { name: 'address', label: 'Адрес (седалище)', required: true, max: 200, wide: true, prefill: 'address', showIf: { field: 'knownToBnb', is: 'Не' } },
          {
            name: 'latinName', label: 'Наименование на латиница', required: true, max: 200, wide: true, showIf: { field: 'knownToBnb', is: 'Не' },
            pattern: '^[A-Za-z0-9 .,&\'()/"-]+$', patternError: 'Използвайте само латински букви, цифри и обичайни знаци.',
          },
          { name: 'phone', label: 'Телефон', required: true, max: 30, prefill: 'phone', showIf: { field: 'knownToBnb', is: 'Не' } },
          {
            name: 'representative', label: 'Представляващо лице', required: true, max: 160, prefill: 'representative',
            hint: 'име и фамилия; при няколко – едно по избор', showIf: { field: 'knownToBnb', is: 'Не' },
          },
          {
            name: 'activityCode', label: 'Код на икономическа дейност по КИД 2025', required: true, max: 10, placeholder: 'Например 62.10',
            pattern: '^\\d{2}(\\.\\d{1,2})?$', patternError: 'Кодът е във формат 62 или 62.10.', showIf: { field: 'knownToBnb', is: 'Не' },
          },
          {
            name: 'bnbEmail', label: 'Имейл за електронни съобщения от БНБ', kind: 'email', required: true, max: 200, prefill: 'contactEmail',
            showIf: { field: 'knownToBnb', is: 'Не' },
          },
        ],
      },
      {
        name: 'account', label: '2–3. Сметката и лицето, при което е открита',
        fields: [
          {
            name: 'cashPool', label: 'Сметка по договор за управление на средства (cash pool)', kind: 'choice', required: true, wide: true,
            options: ['Не', 'Единна сметка (single account cash pool)', 'Физическа сметка (physical cash pool)', 'Виртуална сметка (notional cash pool)'],
          },
          { name: 'term', label: 'Срочност', kind: 'choice', required: true, options: ['Краткосрочна', 'Безсрочна/Дългосрочна'] },
          {
            name: 'transferable', label: 'Вид', kind: 'choice', required: true, options: ['Прехвърляема', 'Непрехвърляема'],
            hint: 'разплащателна сметка е прехвърляема; срочен или спестовен депозит е непрехвърляема',
          },
          { name: 'openedOn', label: 'Дата на откриване', kind: 'date', required: true },
          { name: 'currency', label: 'Валута на сметката', kind: 'currency', required: true, placeholder: 'EUR', hint: 'при многовалутна сметка – една от валутите' },
          { name: 'closedOn', label: 'Дата на закриване', kind: 'date', hint: 'само ако е закрита' },
          { name: 'bankName', label: 'Наименование на банката или институцията', required: true, max: 200, wide: true, hint: 'на латиница' },
          { name: 'country', label: 'Държава', required: true, max: 60, hint: 'например Германия или DE' },
          { name: 'poolLeader', label: 'Лидер на сметката по договора за cash pool', required: true, max: 200, wide: true, showIf: { field: 'cashPool', not: 'Не' } },
          { name: 'poolLeaderCountry', label: 'Държава на лидера', required: true, max: 60, showIf: { field: 'cashPool', not: 'Не' } },
        ],
      },
      {
        name: 'counterparty', label: '4–5. Чуждестранното лице',
        hint: 'При cash pool се посочват връзката и секторът на лидера на сметката. За обикновена сметка в чуждестранна банка обикновено е „Несвързани чуждестранни лица“ и „Депозитни институции (Банки)“.',
        fields: [
          {
            name: 'relation', label: 'Тип на чуждестранното лице', kind: 'choice', required: true, wide: true,
            options: [
              'Преки и непреки чуждестранни инвеститори',
              'Преки и непреки инвестиционни предприятия в чужбина',
              'Други свързани чуждестранни предприятия',
              'Несвързани чуждестранни лица',
            ],
          },
          {
            name: 'sector', label: 'Сектор на чуждестранното лице', kind: 'choice', required: true, wide: true,
            options: [
              'Нефинансово предприятие (S11)',
              'Депозитни институции (Банки) (S122)',
              'Дружества за електронни пари',
              'Фондове на паричния пазар (S123)',
              'Инвестиционни фондове, различни от тези на паричния пазар (S124)',
              'Други финансови посредници без застрахователните (осигурителните) дружества и пенсионните фондове (S125)',
              'Финансови спомагателни организации (S126)',
              'Каптивни финансови институции и заемодатели (S127)',
            ],
          },
        ],
      },
      {
        name: 'interest', label: '6. Лихвени плащания',
        fields: [
          { name: 'method', label: 'Начин на определяне', kind: 'choice', required: true, options: ['Без лихва', 'Фиксиран годишен лихвен процент', 'Плаващ лихвен процент', 'Друг'] },
          { name: 'fixedRate', label: 'Годишен лихвен процент', kind: 'percent', required: true, showIf: { field: 'method', is: 'Фиксиран годишен лихвен процент' } },
          {
            name: 'floatBase', label: 'База на лихвения процент', kind: 'choice', required: true, showIf: { field: 'method', is: 'Плаващ лихвен процент' },
            options: ['MRO', 'ESTR', '1MEURIBOR', '3MEURIBOR', '6MEURIBOR', '12MEURIBOR', 'SOFR', 'OTHER', 'Число'],
          },
          { name: 'floatBaseNumber', label: 'База (число, %)', kind: 'percent', required: true, showIf: { field: 'floatBase', is: 'Число' } },
          { name: 'margin', label: 'Надбавка (%)', kind: 'percent', showIf: { field: 'method', is: 'Плаващ лихвен процент' } },
          { name: 'other', label: 'Опишете начина', required: true, max: 200, wide: true, showIf: { field: 'method', is: 'Друг' } },
        ],
      },
      {
        name: 'declarant', label: 'Декларатор',
        hint: 'Лицето, което съставя и подписва декларацията.',
        fields: [
          { name: 'fullName', label: 'Име и фамилия', required: true, max: 160, prefill: 'representative' },
          { name: 'position', label: 'Длъжност', required: true, max: 100, prefill: 'representativeRole' },
          { name: 'phone', label: 'Телефон', required: true, max: 30, prefill: 'phone' },
          { name: 'email', label: 'Имейл', kind: 'email', required: true, max: 200, prefill: 'contactEmail' },
        ],
      },
    ],
  },
};

// --- Търговски регистър (Агенция по вписванията): заявление по образец А4 за ООД и ЕООД ---
// Изготвяме документите, клиентът ги подписва, ние ги подаваме по електронен път и го уведомяваме след вписването.
const TR_PROCESS = 'Ние изготвяме документите, Вие ги подписвате, ние ги подаваме по електронен път в Търговския регистър и Ви уведомяваме след вписването.';

// Съдружник или ново лице: физическо или юридическо лице.
const PARTY_FIELDS = [
  { name: 'partyType', label: 'Лицето е', kind: 'choice', required: true, options: ['Физическо лице', 'Юридическо лице'] },
  { name: 'fullName', label: 'Три имена', required: true, max: 150, wide: true, showIf: { field: 'partyType', is: 'Физическо лице' } },
  { name: 'egn', label: 'ЕГН или ЛНЧ', kind: 'egn', required: true, showIf: { field: 'partyType', is: 'Физическо лице' } },
  { name: 'companyName', label: 'Наименование', required: true, max: 200, wide: true, showIf: { field: 'partyType', is: 'Юридическо лице' } },
  {
    name: 'eik', label: 'ЕИК или регистрационен номер', required: true, max: 40, showIf: { field: 'partyType', is: 'Юридическо лице' },
    hint: 'за чуждестранно лице – номерът и държавата на регистрация',
  },
  { name: 'address', label: 'Постоянен адрес или седалище', required: true, max: 200, wide: true },
];

Object.assign(FORMS, {
  'tr-ood-new': {
    title: 'Регистрация на ООД или ЕООД в Търговския регистър',
    intro: `Първоначалното вписване се извършва до края на следващия работен ден след подаването. Държавната такса при електронно подаване е 28,12 €. ${TR_PROCESS}`,
    thirdParties: true,
    summary: [{ section: 'company', fields: ['legalForm', 'name', 'city'] }],
    sections: [
      {
        name: 'company', label: 'Новото дружество',
        fields: [
          { name: 'legalForm', label: 'Правна форма', kind: 'choice', required: true, wide: true, options: ['ЕООД – с един собственик', 'ООД – с двама или повече съдружници'] },
          { name: 'name', label: 'Желано наименование', required: true, max: 150, hint: 'без „ООД“ или „ЕООД“' },
          { name: 'altName', label: 'Резервно наименование', max: 150, hint: 'ако желаното е заето' },
          { name: 'latinName', label: 'Изписване на латиница', max: 150 },
          { name: 'city', label: 'Седалище (населено място)', required: true, max: 100, prefill: 'city' },
          { name: 'address', label: 'Адрес на управление', required: true, max: 200, wide: true },
          { name: 'activity', label: 'Предмет на дейност', required: true, max: 1000, wide: true, placeholder: 'Например: търговия със стоки, консултантски услуги' },
          { name: 'capital', label: 'Капитал (€)', kind: 'amount', required: true },
          { name: 'contribution', label: 'Вид на вноската', kind: 'choice', required: true, options: ['Парична', 'Непарична', 'Парична и непарична'] },
          {
            name: 'nonCash', label: 'Какво се внася като непарична вноска', required: true, max: 500, wide: true,
            hint: 'имот, превозно средство, вземане, права и др.; за нея е нужна оценка от вещи лица', showIf: { field: 'contribution', not: 'Парична' },
          },
          {
            name: 'management', label: 'Управление', kind: 'choice', required: true, wide: true,
            options: ['Един управител', 'Няколко управители, които представляват заедно', 'Няколко управители, които представляват поотделно'],
          },
        ],
      },
      {
        name: 'partners', label: 'Съдружници (собственици)', list: true, min: 1, item: 'съдружник',
        fields: [...PARTY_FIELDS, { name: 'share', label: 'Вноска в капитала (€)', kind: 'amount', required: true }],
      },
      {
        name: 'managers', label: 'Управители', list: true, min: 1, item: 'управител',
        hint: 'Управителят подписва нотариално заверено съгласие и образец от подписа си.',
        fields: [
          { name: 'fullName', label: 'Три имена', required: true, max: 150, wide: true },
          { name: 'egn', label: 'ЕГН или ЛНЧ', kind: 'egn', required: true },
          { name: 'citizenship', label: 'Гражданство', required: true, max: 60, initial: 'българско' },
          { name: 'address', label: 'Постоянен адрес', required: true, max: 200, wide: true },
        ],
      },
    ],
  },
  'tr-ood-change': {
    title: 'Промени по партидата на ООД или ЕООД в Търговския регистър',
    intro: `Промените се вписват веднага след изтичане на 3 работни дни от подаването. Държавната такса при електронно подаване е 7,67 €. ${TR_PROCESS}`,
    thirdParties: true,
    summary: [{ section: 'firm', fields: ['companyName', 'eik'] }],
    sections: [
      {
        name: 'firm', label: 'Дружеството',
        fields: [
          { name: 'companyName', label: 'Наименование', required: true, max: 200, wide: true, prefill: 'companyName' },
          { name: 'eik', label: 'ЕИК', kind: 'eik', required: true, prefill: 'eik' },
          { name: 'legalForm', label: 'Правна форма', kind: 'choice', required: true, options: ['ООД', 'ЕООД'] },
          { name: 'decisionOn', label: 'Дата на решението на общото събрание или собственика', kind: 'date', hint: 'ако вече е взето' },
        ],
      },
      {
        name: 'changes', label: 'Какво се променя', list: true, min: 1, item: 'промяна', summaryField: 'subject',
        fields: [
          {
            name: 'subject', label: 'Промяна', kind: 'choice', required: true, wide: true,
            options: [
              'Наименование',
              'Седалище и адрес на управление',
              'Предмет на дейност',
              'Смяна или добавяне на управител',
              'Напускане на управител',
              'Прехвърляне на дружествени дялове',
              'Приемане на нов съдружник',
              'Прекратяване на членство на съдружник',
              'Увеличаване на капитала',
              'Намаляване на капитала',
              'Преобразуване от ЕООД в ООД или обратно',
              'Пререгистрация',
              'Прекратяване и ликвидация',
              'Заличаване след ликвидация',
              'Друго',
            ],
          },
          { name: 'details', label: 'Опишете промяната', required: true, max: 1000, wide: true, placeholder: 'Например: новият адрес на управление е …' },
        ],
      },
      {
        name: 'newPeople', label: 'Нови съдружници или управители', list: true, item: 'лице',
        optional: 'Няма нови съдружници или управители',
        fields: [
          { name: 'role', label: 'Роля', kind: 'choice', required: true, options: ['Съдружник', 'Управител', 'Съдружник и управител'] },
          ...PARTY_FIELDS,
        ],
      },
    ],
  },
});

export const isShown = (field, row) => {
  if (!field.showIf) return true;
  const value = row[field.showIf.field];
  return field.showIf.is !== undefined ? value === field.showIf.is : !!value && value !== field.showIf.not;
};

export const MAX_FORM_ROWS = 20;
// Колоната в Microsoft Lists побира до 63 999 знака; оставяме резерв.
export const MAX_FORM_CHARS = 60000;

// Услуги, които се заявяват със структурирана форма вместо със свободно описание.
export const SERVICE_FORMS = {
  'Декларация по чл. 7а за доставчик на медийни услуги': 'media-7a',
  'Декларация по чл. 7б за разпространител на печатни издания': 'print-7b',
  'Декларация СПБ-2 за сметка в чужбина (БНБ)': 'bnb-spb2',
  'Регистрация на ООД или ЕООД': 'tr-ood-new',
  'Промени по партидата на ООД или ЕООД': 'tr-ood-change',
};
