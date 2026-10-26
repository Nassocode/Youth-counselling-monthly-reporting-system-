require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../../.env') });

const readline = require('node:readline');
const bcrypt = require('bcryptjs');
const db = require('../config/database');

function ask(prompt) {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => terminal.question(prompt, (answer) => {
    terminal.close();
    resolve(answer.trim());
  }));
}

function askSecret(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdin.setRawMode) {
      reject(new Error('Run this command in an interactive terminal to enter the password securely.'));
      return;
    }
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = '';
    const onData = (chunk) => {
      const character = chunk.toString('utf8');
      if (character === '\u0003') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        reject(new Error('Password entry cancelled.'));
      } else if (character === '\r' || character === '\n') {
        process.stdin.off('data', onData);
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        resolve(value);
      } else if (character === '\u0008' || character === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const name = await ask('Administrator name: ');
  const email = await ask('Administrator email: ');
  const password = await askSecret('Password (minimum 8 characters): ');
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    throw new Error('Provide a name, a valid email, and a password of at least 8 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await db.execute(
    `INSERT INTO users (role_id, email, password_hash, display_name)
     SELECT id, ?, ?, ? FROM roles WHERE name = 'admin'`,
    [email.toLowerCase(), passwordHash, name]
  );
  if (!result.affectedRows) throw new Error('Administrator role is missing. Import Database/schema.sql first.');
  console.log(`Administrator account created for ${email.toLowerCase()}.`);
}

main().catch((error) => {
  console.error(error.code === 'ER_DUP_ENTRY' ? 'That email address is already registered.' : error.message);
  process.exitCode = 1;
}).finally(() => db.end());
