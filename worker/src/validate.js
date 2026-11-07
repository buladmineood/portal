import { PERSON_TYPES } from './catalog.js';

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
export function validateContact(body) {
  const fields = {
    phone: clean(body.phone, 30),
    contactEmail: clean(body.contactEmail, 200).toLowerCase(),
    city: clean(body.city, 100),
    address: clean(body.address, 200),
  };
  const errors = {};
  if (!PHONE.test(fields.phone)) errors.phone = 'Въведете валиден телефон, например +359 888 123 456.';
  if (!EMAIL.test(fields.contactEmail)) errors.contactEmail = 'Въведете валиден имейл.';
  if (!fields.city) errors.city = 'Въведете град.';
  if (fields.address.length < 5) errors.address = 'Въведете пълен адрес.';
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
