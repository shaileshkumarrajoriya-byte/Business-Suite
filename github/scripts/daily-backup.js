// Runs inside GitHub Actions every day. Signs in to Firebase anonymously
// (same way the app itself does), pulls every data key, and emails the
// whole thing to your Gmail as a JSON attachment — a second, independent
// backup that lives outside Firebase entirely.
const https = require('https');
const nodemailer = require('nodemailer');

const FIREBASE_API_KEY = "AIzaSyDzABowWH-8LZrRhrIssvDhL4mfVT_DXOk";
const FIREBASE_DB_URL = "https://van-register-default-rtdb.asia-southeast1.firebasedatabase.app";
const KEYS = ["data", "driverData", "expenseData", "loanData", "sharedVehicles"];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let resBody = '';
      res.on('data', d => resBody += d);
      res.on('end', () => { try { resolve(JSON.parse(resBody)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const authRes = await postJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`,
    { returnSecureToken: true }
  );
  const idToken = authRes.idToken;
  if (!idToken) throw new Error('Could not get Firebase auth token: ' + JSON.stringify(authRes));

  const backup = {};
  for (const key of KEYS) {
    const data = await fetchJson(`${FIREBASE_DB_URL}/${key}.json?auth=${idToken}`);
    backup[key] = (data && data.value) ? JSON.parse(data.value) : null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const filename = `daxon-backup-${today}.json`;
  const jsonStr = JSON.stringify(backup, null, 2);

  const studentsCount = (backup.data && backup.data.students) ? backup.data.students.length : 0;
  const driversCount = (backup.driverData && backup.driverData.drivers) ? backup.driverData.drivers.length : 0;
  const vehiclesCount = (backup.data && backup.data.vehicles) ? backup.data.vehicles.length : 0;
  const expensesCount = (backup.expenseData && backup.expenseData.expenses) ? backup.expenseData.expenses.length : 0;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_ADDRESS,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  await transporter.sendMail({
    from: `DAXON MOBILITY Backup <${process.env.GMAIL_ADDRESS}>`,
    to: process.env.GMAIL_ADDRESS,
    subject: `DAXON MOBILITY backup — ${today} (${studentsCount} students, ${driversCount} drivers)`,
    text:
`Automatic daily backup attached.

Students: ${studentsCount}
Vehicles: ${vehiclesCount}
Drivers: ${driversCount}
Expenses: ${expensesCount}

This is an automated message — no action needed, unless one of these
numbers looks wrong (much lower than usual), in which case check the
app and let Claude know.`,
    attachments: [{ filename, content: jsonStr }]
  });

  console.log('Backup emailed successfully:', filename);
}

main().catch(err => { console.error('Backup failed:', err); process.exit(1); });
