/* global output, maestro, MAESTRO_EMAIL, PHASE */
const value = maestro.copiedText;
if (PHASE === 'validation') {
  output.registrationError = value === 'Heslo musí mít alespoň 8 znaků.' ? 'password_short' : 'other_validation';
} else if (PHASE === 'email') {
  output.local.check(value === MAESTRO_EMAIL, 'Disposable email must match its fixture exactly.');
} else throw new Error('Unknown registration input check.');
