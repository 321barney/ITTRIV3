import jwt from 'jsonwebtoken';

const ALG = 'HS256';
const ISS = process.env.JWT_ISS!;
const AUD = process.env.JWT_AUD!;
const SECRET = process.env.JWT_SECRET!;

export function signAccess(payload: object) {
  return jwt.sign(payload as any, SECRET, {
    algorithm: ALG,
    expiresIn: '15m',
    issuer: ISS,
    audience: AUD
  });
}

export function verifyAccess(token: string) {
  return jwt.verify(token, SECRET, {
    algorithms: [ALG],
    issuer: ISS,
    audience: AUD
  });
}
