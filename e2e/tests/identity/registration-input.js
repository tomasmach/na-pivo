/* global output, maestro, MAESTRO_EMAIL, MAESTRO_PASSWORD, PHASE */
const value = maestro.copiedText;
if (PHASE === 'validation') {
  output.registrationError = value === 'Heslo musí mít alespoň 8 znaků.' ? 'password_short' : 'other_validation';
} else if (PHASE === 'email') {
  output.local.check(value === MAESTRO_EMAIL, 'Disposable email must match its fixture exactly.');
} else {
  const passwordMasked = /^[•*]+$/.test(value);
  output.registrationPasswordReadback = passwordMasked ? 'masked_unknown' : 'readable';
  output.local.check(passwordMasked || value === MAESTRO_PASSWORD, 'Readable password must match the fixture; a secure mask cannot reveal its contents.');
}
