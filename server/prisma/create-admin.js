import 'dotenv/config';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { prisma } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const rl = readline.createInterface({ input, output });

try {
  console.log('\nSweety — Create first admin account\n');
  const name = (await rl.question('Admin name: ')).trim();
  const email = (await rl.question('Admin email: ')).trim().toLowerCase();
  const password = await rl.question('Admin password (minimum 12 characters): ');

  if (name.length < 2 || !email.includes('@') || password.length < 12) {
    throw new Error('Enter a valid name, email and password of at least 12 characters.');
  }

  if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL or JWT_SECRET is missing from server/.env.');
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role === 'ADMIN') {
      console.log('An admin account with this email already exists. No changes made.');
    } else {
      throw new Error('This email already belongs to a non-admin account. No role changes were made.');
    }
  } else {
    const user = await prisma.user.create({
      data: {
        name,
        email,
        role: 'ADMIN',
        passwordHash: await hashPassword(password)
      },
      select: { id: true, name: true, email: true, role: true }
    });
    console.log('\nAdmin account created successfully:');
    console.log(user);
  }
} catch (error) {
  console.error('\nAdmin creation failed:', error.message);
  process.exitCode = 1;
} finally {
  rl.close();
  await prisma.$disconnect();
}
