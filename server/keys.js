const crypto = require('crypto');
const { runQuery, allQuery } = require('./db');
require('dotenv').config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
    console.error("FATAL ERROR: ENCRYPTION_KEY is not defined in .env! Must be a 32-byte hex string.");
    process.exit(1);
}
const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
if (keyBuffer.length !== 32) {
    console.error("FATAL ERROR: ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)!");
    process.exit(1);
}

const IV_LENGTH = 16; 

function encrypt(text) {
    if (!text) return text;
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return text;
    let textParts = text.split(':');
    let iv = Buffer.from(textParts.shift(), 'hex');
    let encryptedText = Buffer.from(textParts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

const keyCache = {};

async function loadKeys() {
    const rows = await allQuery('SELECT key, value FROM config');
    rows.forEach(row => {
        try {
            keyCache[row.key] = decrypt(row.value);
        } catch (e) {
            console.error(`Failed to decrypt key: ${row.key}`);
        }
    });
}

async function setKey(key, value) {
    const encrypted = encrypt(value);
    await runQuery(`
        INSERT INTO config (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `, [key, encrypted]);
    keyCache[key] = value;
}

function getKey(key) {
    return keyCache[key] || null;
}

// Automatically export all keys so the AI engine can grab them directly if needed
function getAllKeys() {
    return { ...keyCache };
}

module.exports = {
    encrypt, decrypt, loadKeys, setKey, getKey, getAllKeys
};
