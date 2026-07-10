const { google } = require('googleapis');
const { Readable } = require('stream');

// ── Credential loading ────────────────────────────────────────────────────────
// Supports two patterns so you only need ONE env var on Render:
//
//   GOOGLE_SERVICE_ACCOUNT_JSON  ← paste the entire contents of your
//                                   service account key JSON file here.
//
// Or, if you prefer individual vars:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL  ← "client_email" field from the key file
//   GOOGLE_PRIVATE_KEY            ← "private_key" field from the key file
//   (GOOGLE_DRIVE_FOLDER_ID is optional in both cases)
//
function getCredentials() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        try {
            return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        } catch (e) {
            throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the full key file contents.');
        }
    }

    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        return {
            type: 'service_account',
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            // Render stores \n as a literal backslash-n — fix it back
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        };
    }

    return null;
}

// Returns true if Google Drive is configured and usable
function isConfigured() {
    return !!getCredentials();
}

// Extract just the folder ID whether the user pasted the full Drive folder
// URL or the bare ID. Handles both:
//   https://drive.google.com/drive/folders/17lIC5mqf2Jd1Y...
//   17lIC5mqf2Jd1Y...
function extractFolderId(input) {
    if (!input) return null;
    const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : input.trim();
}

// ── Upload a PDF buffer to Google Drive ──────────────────────────────────────
// Returns the sharing URL stored in the database.
// The download route converts it to a direct download link at request time.
async function uploadToDrive(buffer, originalFilename) {
    const credentials = getCredentials();
    if (!credentials) throw new Error('Google Drive is not configured.');

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    const drive = google.drive({ version: 'v3', auth });

    // Convert buffer to a readable stream (Drive API requires a stream)
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const fileMetadata = { name: originalFilename };

    // Put the file inside a specific Drive folder if one is configured.
    // This MUST be a Shared Drive folder or Shared Drive root ID —
    // service accounts have no storage quota of their own.
    const folderId = extractFolderId(process.env.GOOGLE_DRIVE_FOLDER_ID);
    if (folderId) fileMetadata.parents = [folderId];

    // supportsAllDrives: true is required for Shared Drive uploads.
    // Without it the API returns 403 "Service Accounts do not have storage quota."
    const uploaded = await drive.files.create({
        requestBody: fileMetadata,
        media: { mimeType: 'application/pdf', body: stream },
        fields: 'id',
        supportsAllDrives: true,
    });

    const fileId = uploaded.data.id;

    // Make the file downloadable by anyone with the link.
    // supportsAllDrives: true is required here too for Shared Drive files.
    await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
        supportsAllDrives: true,
    });

    // Return the standard sharing URL — the download route already
    // knows how to extract the file ID and build a direct download link.
    return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
}

// ── Delete a file from Google Drive ─────────────────────────────────────────
// Safe to call even if fileUrl is not a Drive URL (just returns without error).
async function deleteFromDrive(fileUrl) {
    if (!fileUrl || !fileUrl.includes('drive.google.com')) return;

    const match = fileUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return;

    try {
        const credentials = getCredentials();
        if (!credentials) return;

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });
        const drive = google.drive({ version: 'v3', auth });
        await drive.files.delete({ fileId: match[1], supportsAllDrives: true });
    } catch (e) {
        // Log but don't crash — deletion failure shouldn't block the request
        console.warn('Could not delete Drive file:', e.message);
    }
}

module.exports = { uploadToDrive, deleteFromDrive, isConfigured };
