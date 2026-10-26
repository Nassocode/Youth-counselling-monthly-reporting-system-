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
  const email = await ask('Administrator email: ');
  const password = await askSecret('New password (minimum 8 characters): ');
  if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 200) {
    throw new Error('Provide a valid email and a password of 8 to 200 characters.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [admins] = await connection.execute(
      `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.email = ? AND r.name = 'admin' AND u.is_active = 1 FOR UPDATE`,
      [email.toLowerCase()]
    );
    if (!admins.length) throw new Error('No active administrator account was found for that email.');

    await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, admins[0].id]);
    await connection.execute(
      'UPDATE login_sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
      [admins[0].id]
    );
    await connection.commit();
    console.log(`Administrator password updated for ${email.toLowerCase()}.`);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => db.end());
