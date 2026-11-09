import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { prisma } from './db.js';

export async function hashPassword(password) { return bcrypt.hash(password, 12); }
export async function verifyPassword(password, hash) { return bcrypt.compare(password, hash); }
export function signToken(user) { return jwt.sign({ sub: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' }); }
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Please log in to continue.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { id: true, name: true, email: true, language: true, role: true, createdAt: true } });
    if (!user) return res.status(401).json({ error: 'Your session is no longer valid. Please log in again.' });
    req.user = user;
    next();
  } catch { return res.status(401).json({ error: 'Your session is invalid or expired. Please log in again.' }); }
}
