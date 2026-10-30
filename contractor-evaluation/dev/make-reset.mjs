/* يجهّز قيمة ADMIN_RESET لاستعادة دخول حساب على النسخة السحابية: كلمة مؤقتة جديدة تُفرض عند الدخول التالي مرة واحدة.
   الاستخدام: node dev/make-reset.mjs <اسم المستخدم>
   ضع السطر الناتج في Vercel ← Environment Variables باسم ADMIN_RESET (Production، نوع Secret)، ثم أعد النشر.
   بعد الدخول وتغيير كلمة المرور يمكن حذف المتغير؛ وإن بقي فلا يُطبَّق مرة ثانية. */
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../app/lib/core.mjs';
const username = process.argv[2]; if (!username) { console.error('usage: node dev/make-reset.mjs <username>'); process.exit(1); }
const A = 'abcdefghjkmnpqrstuvwxyz23456789'; const b = randomBytes(10); let pw = ''; for (let i = 0; i < 10; i++) pw += A[b[i] % A.length];
const value = JSON.stringify(Object.assign({ username, nonce: randomBytes(9).toString('hex') }, await hashPassword(pw)));
console.log('temporary password: ' + pw); console.log('ADMIN_RESET=' + value);
