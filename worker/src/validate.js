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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9][0-9 ()\/-]{5,19}$/;
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

export function validateRegistration(body) {
  const { fields: contact, errors } = validateContact(body);
  const fields = {
    ...contact, firstName: '', middleName: '', lastName: '',
    companyName: '', eik: '', vatNumber: '', representative: '',
  };

  if (body.kind === 'individual') {
    fields.personType = PERSON_TYPES.individual;
    fields.firstName = clean(body.firstName, 80);
    fields.middleName = clean(body.middleName, 80);
    fields.lastName = clean(body.lastName, 80);
    if (!PERSON_NAME.test(fields.firstName)) errors.firstName = 'Въведете име.';
    if (fields.middleName && !PERSON_NAME.test(fields.middleName)) errors.middleName = 'Презимето съдържа невалидни знаци.';
    if (!PERSON_NAME.test(fields.lastName)) errors.lastName = 'Въведете фамилия.';
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
  } else {
    errors.kind = 'Изберете физическо или юридическо лице.';
  }

  if (body.consent !== true) errors.consent = 'Необходимо е да потвърдите, че сте запознати с политиката.';
  return { fields, errors };
}

export const displayName = (c) =>
  c.companyName || [c.firstName, c.lastName].filter(Boolean).join(' ');
