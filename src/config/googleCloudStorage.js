const { Storage } = require('@google-cloud/storage');

// ── Credential loading ────────────────────────────────────────────────────────
//
//   GOOGLE_SERVICE_ACCOUNT_JSON  ← paste the entire contents of your
//                                   service account key JSON file
//   GOOGLE_STORAGE_BUCKET        ← your GCS bucket name (e.g. "my-library-books")
//
function getCredentials() {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        try {
            return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        } catch (e) {
            throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
        }
    }
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
        return {
            type: 'service_account',
            client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        };
    }
    return null;
}

// Returns true when both credentials and a bucket name are configured
function isConfigured() {
    return !!(getCredentials() && process.env.GOOGLE_STORAGE_BUCKET);
}

function getStorageClient() {
    const credentials = getCredentials();
    if (!credentials) throw new Error('Google Cloud Storage credentials are not configured.');
    return new Storage({ credentials });
}

// ── Upload a PDF buffer to Google Cloud Storage ───────────────────────────────
// Returns a permanent public URL stored in the database.
// Files are made publicly readable so anyone can download without authentication.
async function uploadToStorage(buffer, originalFilename) {
    const storage    = getStorageClient();
    const bucketName = process.env.GOOGLE_STORAGE_BUCKET;
    const bucket     = storage.bucket(bucketName);

    // Prefix with timestamp to avoid collisions on re-uploads of same filename
    const destination = `books/${Date.now()}-${originalFilename}`;
    const file        = bucket.file(destination);

    // resumable: true handles large files reliably (multipart upload under the hood).
    // No public: true here — with uniform bucket-level access enabled, public
    // access is controlled by the bucket's IAM policy (allUsers = Storage Object
    // Viewer), not per-object ACLs. Setting public: true would throw a 403.
    await file.save(buffer, {
        metadata:  { contentType: 'application/pdf' },
        resumable: true,
    });

    // Permanent public URL — no redirect or conversion needed at download time
    return `https://storage.googleapis.com/${bucketName}/${destination}`;
}

// ── Delete a file from Google Cloud Storage ───────────────────────────────────
// Safe to call with any URL — silently skips if it is not a GCS URL.
async function deleteFromStorage(fileUrl) {
    if (!fileUrl || !fileUrl.includes('storage.googleapis.com')) return;

    try {
        const storage    = getStorageClient();
        const bucketName = process.env.GOOGLE_STORAGE_BUCKET;

        // URL format: https://storage.googleapis.com/BUCKET/path/to/file.pdf
        const prefix = `https://storage.googleapis.com/${bucketName}/`;
        if (!fileUrl.startsWith(prefix)) return;

        const objectPath = fileUrl.slice(prefix.length);
        await storage.bucket(bucketName).file(objectPath).delete();
    } catch (e) {
        console.warn('Could not delete GCS file:', e.message);
    }
}

module.exports = { uploadToStorage, deleteFromStorage, isConfigured };
