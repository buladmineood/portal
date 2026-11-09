import PLACES from '../../assets/data/places.json' with { type: 'json' };
import { isShown, MAX_FORM_ROWS, PERSON_TYPES } from './catalog.js';

export function clean(value, max, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  const pattern = multiline ? /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g;
  return value.replace(pattern, multiline ? '' : ' ').trim().slice(0, max);
}

export function isValidEik(eik) {
  if (!/^(\d{9}|\d{13})$/.test(eik)) return false;
  const d = [...eik].map(Number);
  const check = (weights, offset = 0) => weights.reduce((sum, w, i) => sum + w * d[i + offset], 0) % 11;
  let ninth = check([1, 2, 3, 4, 5, 6, 7, 8]);
  if (ninth === 10) ninth = check([3, 4, 5, 6, 7, 8, 9, 10]) % 10;
  if (ninth !== d[8]) return false;
  if (eik.length === 9) return true;
  let last = check([2, 7, 3, 5], 8);
  if (last === 10) last = check([4, 9, 5, 7], 8) % 10;
  return last === d[12];
}

function isValidEgn(egn) {
  const d = [...egn].map(Number);
  const yy = d[0] * 10 + d[1];
  const mm = d[2] * 10 + d[3];
  const dd = d[4] * 10 + d[5];
  let year;
  let month;
  if (mm >= 1 && mm <= 12) { year = 1900 + yy; month = mm; }
  else if (mm >= 21 && mm <= 32) { year = 1800 + yy; month = mm - 20; }
  else if (mm >= 41 && mm <= 52) { year = 2000 + yy; month = mm - 40; }
  else return false;
  const date = new Date(Date.UTC(year, month - 1, dd));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== dd) return false;
  const sum = [2, 4, 8, 5, 10, 9, 7, 3, 6].reduce((s, w, i) => s + w * d[i], 0);
  return (sum % 11) % 10 === d[9];
}

function isValidLnch(lnch) {
  const d = [...lnch].map(Number);
  const sum = [21, 19, 17, 13, 11, 9, 7, 3, 1].reduce((s, w, i) => s + w * d[i], 0);
  return sum % 10 === d[9];
}

export function isValidEgnOrLnch(value) {
  return /^\d{10}$/.test(value) && (isValidEgn(value) || isValidLnch(value));
}

export const maskEgn = (egn) => (egn ? `••••••••${egn.slice(-2)}` : '');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const isValidEmail = (email) => EMAIL.test(email);
export function passwordError(password) {
  if (password.length < 10) return 'Паролата трябва да е поне 10 знака.';
  if (password.length > 128) return 'Паролата трябва да е до 128 знака.';
  return null;
}
const PHONE =/^\+?[0-9][0-9 ()\/-]{5,19}$/;
const PERSON_NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

// Връща { fields, errors }. Приемат се само изброените полета, а полетата от другия вид лице се изчистват.
// Области и общини от същия справочник, който ползва формата за търсене (GeoNames, CC BY 4.0).
const REGION_MUNICIPALITIES = new Map(PLACES.regions.map((region) => [region, new Set()]));
for (const [municipality, regionIndex] of PLACES.municipalities) {
  REGION_MUNICIPALITIES.get(PLACES.regions[regionIndex]).add(municipality);
}

export function validateContact(body) {
  const fields = {
    phone: clean(body.phone, 30),
    contactEmail: clean(body.contactEmail, 200).toLowerCase(),
    region: clean(body.region, 60),
    municipality: clean(body.municipality, 80),
    city: clean(body.city, 100),
    postalCode: clean(body.postalCode, 4),
    address: clean(body.address, 200),
  };
  const errors = {};
  if (!PHONE.test(fields.phone)) errors.phone = 'Въведете валиден телефон, например +359 888 123 456.';
  if (!EMAIL.test(fields.contactEmail)) errors.contactEmail = 'Въведете валиден имейл.';
  // Областта и общината са по избор (например за адрес в чужбина), но ако са попълнени, трябва да си съответстват.
  if (fields.region && !REGION_MUNICIPALITIES.has(fields.region)) errors.region = 'Изберете област от списъка.';
  else if (fields.municipality && fields.region && !REGION_MUNICIPALITIES.get(fields.region).has(fields.municipality)) {
    errors.municipality = 'Общината не е в избраната област.';
  }
  if (!fields.city) errors.city = 'Въведете населено място.';
  if (fields.postalCode && !/^\d{4}$/.test(fields.postalCode)) errors.postalCode = 'Пощенският код е 4 цифри.';
  if (fields.address.length < 3) errors.address = 'Въведете улица и номер или квартал и блок.';
  return { fields, errors };
}

// ЕГН/ЛНЧ тук е по желание: задължително е само за услугите с requiresIdentity в каталога.
export function validateRegistration(body) {
  const { fields: contact, errors } = validateContact(body);
  const fields = {
    ...contact, firstName: '', middleName: '', lastName: '', egn: '',
    companyName: '', eik: '', vatNumber: '', representative: '',
    representativeRole: '', representativeEgn: '', correspondenceAddress: '', contactPerson: '',
  };

  if (body.kind === 'individual') {
    fields.personType = PERSON_TYPES.individual;
    fields.firstName = clean(body.firstName, 80);
    fields.middleName = clean(body.middleName, 80);
    fields.lastName = clean(body.lastName, 80);
    if (!PERSON_NAME.test(fields.firstName)) errors.firstName = 'Въведете име.';
    if (fields.middleName && !PERSON_NAME.test(fields.middleName)) errors.middleName = 'Презимето съдържа невалидни знаци.';
    if (!PERSON_NAME.test(fields.lastName)) errors.lastName = 'Въведете фамилия.';
    fields.egn = clean(body.egn, 10);
    if (fields.egn && !isValidEgnOrLnch(fields.egn)) errors.egn = 'Въведете валидно ЕГН или ЛНЧ от 10 цифри.';
  } else if (body.kind === 'company') {
    fields.personType = PERSON_TYPES.company;
    fields.companyName = clean(body.companyName, 200);
    fields.eik = clean(body.eik, 13);
    fields.vatNumber = clean(body.vatNumber, 12).toUpperCase().replace(/\s/g, '');
    fields.representative = clean(body.representative, 160);
    if (fields.companyName.length < 2) errors.companyName = 'Въведете наименование на фирмата.';
    if (!isValidEik(fields.eik)) errors.eik = 'Този ЕИК/БУЛСТАТ не е валиден. Проверете цифрите.';
    if (fields.vatNumber && !/^BG\d{9,10}$/.test(fields.vatNumber)) errors.vatNumber = 'ДДС номерът е във формат BG123456789.';
    if (!PERSON_NAME.test(fields.representative)) errors.representative = 'Въведете името на представляващия.';
    fields.representativeRole = clean(body.representativeRole, 100);
    fields.representativeEgn = clean(body.representativeEgn, 10);
    fields.correspondenceAddress = clean(body.correspondenceAddress, 200);
    fields.contactPerson = clean(body.contactPerson, 160);
    if (fields.representativeEgn && !isValidEgnOrLnch(fields.representativeEgn)) {
      errors.representativeEgn = 'Въведете валидно ЕГН или ЛНЧ от 10 цифри.';
    }
  } else {
    errors.kind = 'Изберете физическо или юридическо лице.';
  }

  if (body.consent !== true) errors.consent = 'Необходимо е да потвърдите, че сте запознати с политиката.';
  return { fields, errors };
}

export const displayName = (c) =>
  c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ');

// --- Структурирани форми (декларации, виж FORMS в catalog.js) ---

const YES = 'Да';
const NO = 'Не';
const WEBSITE = /^(https?:\/\/)?[\p{L}\d-]+(\.[\p{L}\d-]+)+(\/\S*)?$/u;

function isPastDate(value, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) && value >= '1950-01-01' && value <= today;
}

// Приема „1 234,50“ или „1234.5“ и връща „1234.50“.
function normalizeAmount(value) {
  const compact = value.replace(/[\s\u00A0]/g, '').replace(',', '.');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(compact)) return null;
  const amount = Number(compact);
  return amount > 0 ? amount.toFixed(2) : null;
}

// Процент с до 4 знака след десетичната запетая; може да е отрицателен (например при ESTR).
function normalizePercent(value) {
  const compact = value.replace(/[\s%]/g, '').replace(',', '.');
  if (!/^-?\d{1,3}(\.\d{1,4})?$/.test(compact) || Math.abs(Number(compact)) > 100) return null;
  return String(Number(compact));
}

function validateFormField(field, raw, today) {
  const value = clean(typeof raw === 'string' ? raw : '', field.max || 200);
  if (!value) return { value, error: field.required ? 'Попълнете полето.' : null };
  switch (field.kind) {
    case 'email':
      return { value: value.toLowerCase(), error: EMAIL.test(value) ? null : 'Въведете валиден имейл.' };
    case 'egn':
      return { value, error: isValidEgnOrLnch(value) ? null : 'Въведете валидно ЕГН или ЛНЧ от 10 цифри.' };
    case 'eik':
      return { value, error: isValidEik(value) ? null : 'Този ЕИК/БУЛСТАТ не е валиден. Проверете цифрите.' };
    case 'date':
      return { value, error: isPastDate(value, today) ? null : 'Въведете валидна дата, която не е в бъдещето.' };
    case 'amount': {
      const amount = normalizeAmount(value);
      return { value: amount || value, error: amount ? null : 'Въведете сума, например 1500 или 1500,50.' };
    }
    case 'percent': {
      const percent = normalizePercent(value);
      return { value: percent ?? value, error: percent !== null ? null : 'Въведете процент, например 2,5.' };
    }
    case 'currency': {
      const code = value.toUpperCase();
      return { value: code, error: /^[A-Z]{3}$/.test(code) ? null : 'Въведете трибуквен код на валутата, например EUR или USD.' };
    }
    case 'yesno':
      return { value, error: value === YES || value === NO ? null : 'Изберете „Да“ или „Не“.' };
    case 'choice':
      return { value, error: field.options.includes(value) ? null : 'Изберете от списъка.' };
    default:
      if (field.name === 'website' && !WEBSITE.test(value)) return { value, error: 'Въведете адрес като www.primer.bg.' };
      if (field.pattern && !new RegExp(field.pattern, 'u').test(value)) return { value, error: field.patternError || 'Проверете стойността.' };
      return { value, error: null };
  }
}

// Проверява един ред (или единичната секция). Поле с showIf се пази само ако условието е изпълнено
// според вече проверените полета, така че скрито поле скрива и зависещите от него.
function validateFormRow(fields, input, prefix, errors, today) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const row = {};
  for (const field of fields) {
    if (!isShown(field, row)) continue;
    const { value, error } = validateFormField(field, source[field.name], today);
    row[field.name] = value;
    if (error) errors[`${prefix}.${field.name}`] = error;
  }
  return row;
}

// Връща { data, errors }. Ключовете на грешките съвпадат с имената на полетата във формата: form.<секция>.<ред>.<поле>.
export function validateForm(definition, input, today = new Date().toISOString().slice(0, 10)) {
  const body = input && typeof input === 'object' ? input : {};
  const data = {};
  const errors = {};
  for (const section of definition.sections) {
    const key = `form.${section.name}`;
    if (!section.list) {
      data[section.name] = validateFormRow(section.fields, body[section.name], key, errors, today);
      continue;
    }
    const given = body[section.name] && typeof body[section.name] === 'object' ? body[section.name] : {};
    const none = !!section.optional && given.none === true;
    const rows = none || !Array.isArray(given.rows) ? [] : given.rows;
    if (rows.length > MAX_FORM_ROWS) {
      errors[key] = `Най-много ${MAX_FORM_ROWS} реда. За повече ни пишете след като подадете заявката.`;
      continue;
    }
    if (!none && rows.length === 0) {
      errors[key] = section.optional ? 'Добавете поне един ред или отбележете „Неприложимо“.' : 'Добавете поне един ред.';
    }
    data[section.name] = { none, rows: rows.map((row, i) => validateFormRow(section.fields, row, `${key}.${i}`, errors, today)) };
  }
  return { data, errors };
}

// ЕГН в записана форма се показва скрито, докато оператор изрично не поиска пълните данни.
export function maskFormData(definition, data) {
  const masked = structuredClone(data || {});
  for (const section of definition.sections) {
    const egnFields = section.fields.filter((f) => f.kind === 'egn').map((f) => f.name);
    if (!egnFields.length) continue;
    const rows = section.list ? masked[section.name]?.rows || [] : [masked[section.name] || {}];
    for (const row of rows) for (const name of egnFields) if (row[name]) row[name] = maskEgn(row[name]);
  }
  return masked;
}
