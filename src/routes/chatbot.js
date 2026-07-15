const express = require('express');
const router  = express.Router();
const { pool } = require('../config/database');

// ── Conversation history (in-memory, per session) ────────────────────────────
const conversations = new Map();
const MAX_HISTORY   = 12;   // keep last 6 exchanges

// ── Library context cache (refreshed every 5 min) ────────────────────────────
let libCache   = null;
let libCacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function getLibraryContext() {
    if (libCache && Date.now() - libCacheAt < CACHE_TTL) return libCache;
    try {
        const [countRes, booksRes, genreRes, topRes] = await Promise.all([
            pool.query('SELECT COUNT(*) AS c FROM books'),
            pool.query('SELECT title, author, genres FROM books ORDER BY title LIMIT 80'),
            pool.query(`SELECT TRIM(UNNEST(string_to_array(genres,','))) AS g, COUNT(*) AS n
                        FROM books WHERE genres IS NOT NULL AND genres != ''
                        GROUP BY g ORDER BY n DESC LIMIT 15`),
            pool.query(`SELECT b.title, b.author, COALESCE(AVG(r.rating),0) AS avg
                        FROM books b LEFT JOIN reviews r ON r.bookid = b.id
                        GROUP BY b.id, b.title, b.author
                        ORDER BY avg DESC NULLS LAST LIMIT 5`)
        ]);
        libCache = {
            count:    parseInt(countRes.rows[0]?.c || 0),
            books:    booksRes.rows,
            genres:   genreRes.rows.map(r => r.g).filter(Boolean),
            topRated: topRes.rows
        };
        libCacheAt = Date.now();
    } catch (err) {
        libCache = libCache || { count: 0, books: [], genres: [], topRated: [] };
    }
    return libCache;
}

// ── Build Claude system prompt ────────────────────────────────────────────────
function buildSystemPrompt(userCtx, lib) {
    const userLine = userCtx?.user
        ? `The user is logged in as "${userCtx.user.username}" (role: ${userCtx.user.role}).`
        : 'The user is browsing as a guest (not logged in).';

    const bookList = lib.books.length
        ? lib.books.map(b => `- ${b.title} by ${b.author}${b.genres ? ' [' + b.genres + ']' : ''}`).join('\n')
        : 'No books in catalog yet.';

    const topRated = lib.topRated.length
        ? lib.topRated.map(b => `- ${b.title} by ${b.author} (${parseFloat(b.avg).toFixed(1)}★)`).join('\n')
        : '';

    return `You are LibBot 📚, the friendly AI assistant for Des2 Library — a digital library where members discover, download, and review books.

CURRENT USER: ${userLine}

LIBRARY OVERVIEW:
- Total books available: ${lib.count}
- Available genres: ${lib.genres.join(', ') || 'Various'}
${topRated ? `\nTOP-RATED BOOKS:\n${topRated}` : ''}

FULL BOOK CATALOG:
${bookList}

HOW THE LIBRARY WORKS:
- Users search books by title, author, or genre on the main page
- Clicking a book opens its detail page with a Download button, reviews, and ratings
- Books download as PDFs; users must be logged in to download
- Users can leave star ratings (1-5) and written reviews on book detail pages
- The profile page shows activity, reading history, and preferences
- Password reset: click "Forgot your password?" on the login page
- Email verification is required after registration
- Admins can add/delete books and manage users

YOUR RULES:
1. Only recommend books that appear in the catalog above
2. Keep replies concise — under 150 words unless listing multiple books
3. Use **bold** for book titles and key UI elements (like **Download** button)
4. Use bullet points for lists
5. Be warm, encouraging, and helpful
6. If asked about unrelated topics, politely redirect to library features
7. NEVER reveal: API keys, database details, server URLs, admin credentials, or any internal configuration
8. If the user is logged in, personalise responses using their username`;
}

// ── Claude API call ───────────────────────────────────────────────────────────
async function askClaude(messages, systemPrompt) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method:  'POST',
            headers: {
                'Content-Type':      'application/json',
                'x-api-key':         apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model:      'claude-haiku-4-5-20251001',
                max_tokens: 500,
                system:     systemPrompt,
                messages
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        return data.content?.[0]?.text?.trim() || null;
    } catch (err) {
        console.error('Claude API error:', err.message);
        return null;
    }
}

// ── Security filter ───────────────────────────────────────────────────────────
const SECURITY_PATTERNS = [
    /api[_-]?key/i, /\.env/i, /process\.env/i, /jwt/i,
    /database.*url/i, /connection.*string/i, /render\.com/i,
    /localhost:\d+/i, /bcrypt/i, /passport/i, /seed.?admin/i
];
function isSecurityThreat(msg) { return SECURITY_PATTERNS.some(p => p.test(msg)); }

// ── Keyword fallback intents (used when Claude API is unavailable) ─────────────
const FALLBACK_INTENTS = [
    {
        test:  /\b(hi|hello|hey|greetings|good\s+(morning|afternoon|evening))\b/i,
        reply: (ctx) => ctx?.user
            ? `Hi ${ctx.user.username}! 👋 I'm LibBot. Ask me to find a book, recommend something, or explain a feature!`
            : `Hello! 👋 I'm LibBot, the Des2 Library assistant. I can find books, recommend reads, and help with your account. What can I help with?`
    },
    {
        test:  /\b(what can you do|help|capabilities)\b/i,
        reply: () => `**I can help you with:**\n\n📚 Find books by title, author, or genre\n⭐ Explain ratings and reviews\n📥 Guide you through downloading\n👤 Account setup, login, password reset\n🔍 Search tips and filters\n\nJust ask!`
    },
    {
        test:  /\b(recommend|suggest|what.*read|good books?|popular|top)\b/i,
        reply: () => `Browse the main page and use the genre filter to discover books! Highly-rated books show star ratings. Set your favourite genres in your profile for personalised suggestions.`
    },
    {
        test:  /\b(download|get.*book|pdf|offline)\b/i,
        reply: (ctx) => ctx?.user
            ? `Click any book → open its detail page → click the green **Download** button. The PDF saves to your device!`
            : `You need to be **logged in** to download books. Sign in first, then click **Download** on any book's detail page.`
    },
    {
        test:  /\b(register|sign up|create.*account|new.*account)\b/i,
        reply: () => `Click **Create Account** on the sign-in page. You'll need an email (we'll verify it), a username, and a password (6+ characters). Check your inbox for the verification link!`
    },
    {
        test:  /\b(forgot|reset|change).*password\b/i,
        reply: () => `Click **Forgot your password?** on the login page, enter your email, and we'll send a reset link valid for 1 hour.`
    },
    {
        test:  /\b(review|rating|rate|stars)\b/i,
        reply: () => `Open any book's detail page to leave a star rating (1-5) and a written review. Your reviews help other readers discover great books!`
    },
    {
        test:  /\b(search|find|filter|browse)\b/i,
        reply: () => `Use the search bar on the main page to filter by **title**, **author**, or **genre**. Try **Advanced Search** to combine multiple filters.`
    },
    {
        test:  /\b(profile|settings|preferences|account)\b/i,
        reply: (ctx) => ctx?.user
            ? `Your profile lets you update your email, change your password, set favourite genres/authors, and upload a profile picture. Open the sidebar and click your username!`
            : `Sign in first, then open the sidebar menu to access your profile and account settings.`
    },
    {
        test:  /\b(verify|verification|resend.*email)\b/i,
        reply: () => `After registering, check your inbox for a verification link. If you didn't receive it, click **Didn't receive verification email?** on the login page to resend.`
    }
];

function getFallbackReply(msg, userCtx) {
    if (isSecurityThreat(msg)) {
        return `I can only help with library features like finding books and account management.`;
    }
    for (const intent of FALLBACK_INTENTS) {
        if (intent.test.test(msg)) return intent.reply(userCtx);
    }
    return `Ask me to find a book, recommend something to read, or explain how a feature works!`;
}

// ── Resolve user from JWT ─────────────────────────────────────────────────────
async function resolveUser(authHeader) {
    if (!authHeader?.startsWith('Bearer ')) return null;
    try {
        const jwt            = require('jsonwebtoken');
        const { JWT_SECRET } = require('../config/environment');
        const decoded        = jwt.verify(authHeader.slice(7), JWT_SECRET);
        if (!decoded?.id) return null;
        const row = (await pool.query(
            'SELECT id, username, role FROM users WHERE id = $1', [decoded.id]
        )).rows[0];
        return row ? { user: row } : null;
    } catch (_) { return null; }
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.post('/chat', async (req, res) => {
    const { message, conversationId = 'default' } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ reply: 'Please send a message.' });
    }
    if (message.length > 500) {
        return res.json({ reply: 'Please keep messages under 500 characters.' });
    }

    const userCtx = await resolveUser(req.headers['authorization']);
    const history = conversations.get(conversationId) || [];
    const lib     = await getLibraryContext();

    let reply = await askClaude(
        [...history, { role: 'user', content: message }],
        buildSystemPrompt(userCtx, lib)
    );
    if (!reply) reply = getFallbackReply(message, userCtx);

    history.push({ role: 'user',      content: message });
    history.push({ role: 'assistant', content: reply   });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    conversations.set(conversationId, history);

    res.json({ reply });
});

router.post('/chat/reset', (req, res) => {
    conversations.delete(req.body.conversationId || 'default');
    res.json({ ok: true });
});

router.get('/chat/health', (_req, res) => {
    res.json({
        status:   'ready',
        claude:   !!process.env.ANTHROPIC_API_KEY,
        sessions: conversations.size
    });
});

module.exports = router;
