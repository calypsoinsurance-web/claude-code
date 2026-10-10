'use strict';
// Usage: npm run hash-password -- "your long password"
const { hashPassword } = require('../src/auth');
const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error('Give a password of at least 12 characters:\n  npm run hash-password -- "my long passphrase"');
  process.exit(1);
}
console.log('Put this line in your .env file (keep it secret):\n');
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(pw)}`);
