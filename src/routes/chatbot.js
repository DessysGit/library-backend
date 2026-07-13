const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { isAuthenticated } = require('../middleware/auth');

// In-memory conversation context with user metadata support
const conversations = new Map();

// ===== SECURITY GUARDRAILS =====
const FORBIDDEN_PATTERNS = [
  // Environment / credentials
  /secret/i, /password\s*=\s*/i, /api[_-]?key/i, /token\s*=\s*/i,
  /database\s*url/i, /connection\s*string/i, /jwt/i, /session[_-]?secret/i,
  /sendgrid/i, /cloudinary/i, /google.*cloud/i, /gcs/i, /bucket/i,
  /localhost:\d+/i, /127\.0\.0\.1:\d+/i, /render\.com/i, /onrender/i,
  /middleware/i, /auth\.js/i, /passport/i, /bcrypt/i,
  /\.env/i, /environment/i, /config/i, /process\.env/i,
  // Technical internals
  /select\s+from/i, /insert\s+into/i, /delete\s+from/i, /sql/i,
  /query/i, /pool/i, /connection/i, /table/i, /column/i,
  /backend.*url/i, /frontend.*url/i, /port/i, /cors/i,
  /multer|cloudinary|storage/i, /aws|s3/i,
  // Admin-only backend details
  /seed\s*admin/i, /grant-admin|revoke-admin/i, /analytics/i,
  // Sensitive paths
  /uploads?\//i, /public\//i, /\.\.\/|\.\.\\/i
];

function containsForbiddenContent(message) {
  return FORBIDDEN_PATTERNS.some(pattern => pattern.test(message));
}

function getSecurityFilteredResponse() {
  return "I can only help with library features like finding books, downloading, reviews, and account management. For security reasons, I can't share technical details or admin-specific backend information. Is there something about books or your account I can help with?";
}

// ===== INTENTS DATABASE =====
const intents = {
  // Book discovery
  bookCount: {
    keywords: /\b(how many books|total books|how much|number of books|book count|many books)\b/i,
    handler: async () => {
      try {
        const result = await pool.query('SELECT COUNT(*) as count FROM books');
        const count = parseInt(result.rows[0]?.count || 0);
        return `We currently have **${count} books** in the Des2 Library! 📚 You can browse them all using the search filters on the main page.`;
      } catch (err) {
        return "You can explore all books on the main page using title, author, or genre search. Give it a try!";
      }
    }
  },

  genreList: {
    keywords: /\b(genres|genre list|categories|what genres|book genres|all genres)\b/i,
    handler: async () => {
      try {
        const result = await pool.query(`
          SELECT TRIM(UNNEST(string_to_array(genres, ','))) as genre, COUNT(*) as count
          FROM books
          WHERE genres IS NOT NULL AND genres != ''
          GROUP BY genre
          ORDER BY count DESC
          LIMIT 12
        `);
        if (result.rows.length > 0) {
          const genreList = result.rows.map(r => `${r.genre} (${r.count})`).join(', ');
          return `We have books in these genres:\n\n${genreList}\n\nYou can search by any of these genres or browse all books on the main page!`;
        }
        return "We have lots of books! Try searching for a specific genre or browse the collection.";
      } catch (err) {
        return "You can browse books by genre on the main page. The most popular genres are Fiction, Mystery, Romance, Sci-Fi, and Fantasy.";
      }
    }
  },

  booksByGenre: {
    keywords: /\b(fiction|mystery|thriller|romance|sci-fi|science fiction|fantasy|biography|history|self-help)\b/i,
    handler: async (msg) => {
      const match = msg.toLowerCase().match(/\b(fiction|mystery|thriller|romance|sci-fi|science fiction|fantasy|biography|history|self-help)\b/i);
      if (!match) return null;
      
      const genre = match[1].toLowerCase();
      try {
        const result = await pool.query(
          'SELECT title, author, cover FROM books WHERE genres ILIKE $1 ORDER BY title LIMIT 5',
          [`%${genre}%`]
        );
        
        if (result.rows.length === 0) {
          return `We don't have many books in the **${genre}** category yet, but we're always adding more! Check back soon or try a different genre.`;
        }
        
        const books = result.rows.map(b => `• *${b.title}* by ${b.author}`).join('\n');
        return `Here are some ${genre} books in our library:\n\n${books}\n\nClick on any book on the main page to read more and download it!`;
      } catch (err) {
        return `You can find ${genre} books using the genre filter on the main page. Search for "${genre}" to see what's available!`;
      }
    }
  },

  bookSearch: {
    keywords: /\b(find (a )?book|search (for|book)|looking (for|up)|any books about|books on)\b/i,
    handler: async (msg, userContext) => {
      const titleMatch = msg.match(/(find|search|looking).*?(for|up)?\s+"([^"]+)"|'([^']+)'|([A-Z][a-zA-Z\s]+)$/i);
      const title = titleMatch ? (titleMatch[4] || titleMatch[5] || '').trim() : null;
      
      if (title && title.length > 2) {
        try {
          const result = await pool.query(
            'SELECT id, title, author, genres FROM books WHERE title ILIKE $1 LIMIT 3',
            [`%${title}%`]
          );
          
          if (result.rows.length > 0) {
            const books = result.rows.map(b => 
              `• **${b.title}** by ${b.author}${b.genres ? ` (${b.genres})` : ''}`
            ).join('\n');
            return `Found ${result.rows.length} book(s) matching "${title}":\n\n${books}\n\nClick on the book title on the main page to see details and download!`;
          }
          return `Couldn't find "${title}" in our library. Try a different search term or browse all books.`;
        } catch (err) {
          return `You can search for books by title or author on the main page. Use the search bar at the top!`;
        }
      }
      return "Use the search bar on the main page to find books by title, author, or genre. Try entering a book title you're looking for!";
    }
  },

  // Authors
  authorSearch: {
    keywords: /\b(author|writer|written by|by [A-Z])|who wrote\b/i,
    handler: async (msg) => {
      const authorMatch = msg.match(/\b(author|writer|by)\s+([A-Z][a-zA-Z]+)/i) || 
                         msg.match(/by\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/i);
      const author = authorMatch ? authorMatch[2] || authorMatch[1] : null;
      
      if (author) {
        try {
          const result = await pool.query(
            'SELECT title, genres FROM books WHERE author ILIKE $1 ORDER BY title LIMIT 5',
            [`%${author}%`]
          );
          
          if (result.rows.length > 0) {
            const books = result.rows.map(b => `• *${b.title}*${b.genres ? ` (${b.genres})` : ''}`).join('\n');
            return `**${author}** books in our library:\n\n${books}\n\nSearch by author on the main page to see all their books!`;
          }
          return `We don't have any books by **${author}** yet. Would you like to suggest a book for us to add?`;
        } catch (err) {
          return `You can search for books by author using the search bar on the main page.`;
        }
      }
      return "You can search for books by author on the main page. Enter the author's name in the search field!";
    }
  },

  // User Account
  loginHelp: {
    keywords: /\b(login|sign in|signin|log in|account access)\b/i,
    handler: (msg, userContext) => {
      if (userContext?.user) {
        return `You're already signed in as **${userContext.user.username}**! Welcome back to Des2 Library. 👋`;
      }
      return "To sign in, click the Login button on the auth page. You can use either your email or username with your password. New users need to verify their email after registration.";
    }
  },

  registerHelp: {
    keywords: /\b(register|sign up|signup|create account|new account)\b/i,
    handler: (msg, userContext) => {
      if (userContext?.user) {
        return `You're already logged in as **${userContext.user.username}**. You can create additional accounts for friends/family!`;
      }
      return "To create an account, click 'Create Account' on the auth page. You'll need an email (we'll verify it), a unique username (letters/numbers/underscores), and a password (6+ chars). Check your email for the verification link!";
    }
  },

  passwordReset: {
    keywords: /\b(forgot password|reset password|password reset|change password)\b/i,
    handler: () => {
      return "To reset your password: Click 'Forgot your password?' on the login page, enter your email, and we'll send you a reset link. The link expires in 1 hour. After resetting, you can log in with your new password.";
    }
  },

  emailVerify: {
    keywords: /\b(verify email|verification email|email verified|resend.*verification|didn't receive.*email)\b/i,
    handler: (msg, userContext) => {
      if (userContext?.user) {
        return `Your account is already verified, ${userContext.user.username}! If you're having trouble accessing your account, try the password reset option.`;
      }
      return "After registering, check your email for a verification link. Click it to activate your account. If you didn't receive it, click 'Didn't receive verification email?' on the login page to resend it.";
    }
  },

  // Profile
  profileHelp: {
    keywords: /\b(profile|account settings|my account|edit profile|preferences)\b/i,
    handler: (msg, userContext) => {
      if (!userContext?.user) {
        return "You need to be logged in to access your profile. Sign in first, then click your username in the sidebar to view your profile!";
      }
      return "On your profile page, you can: update your email, change your password, set favorite genres/authors/books, and upload a profile picture. Your reading activity and reviews are also displayed there!";
    }
  },

  // Download
  downloadHelp: {
    keywords: /\b(download|get book|read book|read online|pdf|get (the )?book)\b/i,
    handler: (msg, userContext) => {
      if (!userContext?.user) {
        return "You need to be logged in to download books. Sign in first, then click the 'Download' button on any book's detail page!";
      }
      return "To download a book: 1) Find a book you like, 2) Click on it to open the details page, 3) Click the green Download button. The PDF will download or open in your browser!";
    }
  },

  // Reviews
  reviewHelp: {
    keywords: /\b(review|rating|rate.*book|stars|like|dislike)\b/i,
    handler: (msg, userContext) => {
      if (!userContext?.user) {
        return "You can read reviews without logging in! Signed-in users can rate books with 1-5 stars and write reviews to share their thoughts.";
      }
      return "Rate books with 1-5 stars and write reviews! Click the stars on a book's detail page to submit your review. Your reviews help other readers discover great books.";
    }
  },

  // Recommendations
  recommendHelp: {
    keywords: /\b(recommend|suggest|for me|personalized|recommended|similar)\b/i,
    handler: (msg, userContext) => {
      if (!userContext?.user) {
        return "Sign in to get personalized book recommendations! We suggest books based on your favorite genres and authors. You can also set your preferences in your profile after logging in.";
      }
      return "Check the 'Recommended Books' section at the bottom of any book's details page! We use your favorite genres and liked books to suggest titles you'll love. Like more books to improve recommendations!";
    }
  },

  // Search
  searchHelp: {
    keywords: /\b(search|find|look up|filter|browse|how to find)\b/i,
    handler: () => {
      return "Use the search bar on the main page! You can:\n• Search by **title** (e.g., 'The Alchemist')\n• Search by **author** (e.g., 'Coelho')\n• Search by **genre** (e.g., 'Fantasy')\n• Combine filters using the Advanced Search button!\n\nClick 'Apply Filters' to see results.";
    }
  },

  // Greeting
  greeting: {
    keywords: /\b(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|sup|yo)\b/i,
    handler: (msg, userContext) => {
      const greetings = [
        `Hello! I'm LibBot, your Des2 Library assistant. I can help you find books, explain library features, or assist with your account. What can I do for you?`,
        `Hi there! 👋 I'm here to help with book recommendations, searches, and account questions. What would you like to know?`,
        `Welcome to Des2 Library! I can help you discover your next great read or navigate the library. How can I assist?`
      ];
      return userContext?.user 
        ? `${greetings[0]} Welcome back, ${userContext.user.username}!`
        : greetings[Math.floor(Math.random() * greetings.length)];
    }
  },

  // Help
  help: {
    keywords: /\b(help|what can you do|what do you know|capabilities|assist|support)\b/i,
    handler: () => {
      return `**I can help you with:**\n\n📚 **Books**: Find books by title/author/genre, get book recommendations\n👤 **Account**: Login, register, password reset, profile settings\n⭐ **Reviews**: How to rate and review books\n📥 **Downloads**: How to download books for offline reading\n🔍 **Search**: How to use the search filters\n\nJust ask me anything about these features!`;
    }
  }
};

// ===== RESPONSE FUNCTIONS =====
async function getResponse(message, conversationId, userContext = null) {
  const msg = message.toLowerCase().trim();
  
  // Security check first
  if (containsForbiddenContent(msg)) {
    return getSecurityFilteredResponse();
  }

  // Get conversation history
  let context = conversations.get(conversationId) || [];
  context.push(msg);
  if (context.length > 5) context.shift();
  conversations.set(conversationId, context);

  // Try each intent handler
  for (const [name, intent] of Object.entries(intents)) {
    if (intent.keywords.test(msg)) {
      try {
        const response = await intent.handler(msg, userContext);
        return response || getDefaultResponse(userContext);
      } catch (err) {
        console.error(`Intent ${name} error:`, err);
        continue;
      }
    }
  }

  return getDefaultResponse(userContext);
}

function getDefaultResponse(userContext) {
  const responses = [
    "I can help you with books, account questions, reviews, and downloads. What are you looking for?",
    "Ask me about finding books, logging in, resetting passwords, or downloading. What do you need?",
    "I'm here to help! Try asking about a genre, how to download, or account features."
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ===== API ENDPOINTS =====

// Health check
router.get('/chat/health', (req, res) => {
  res.json({
    status: 'ready',
    mode: 'contextual_database_enhanced',
    active_conversations: conversations.size,
    timestamp: new Date().toISOString()
  });
});

// Main chat endpoint - accepts optional JWT for user context
router.post('/chat', async (req, res) => {
  const userMessage = req.body.message;
  const conversationId = req.body.conversationId || req.sessionID || 'default';
  const authHeader = req.headers['authorization'];
  
  // Validation
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return res.status(400).json({ 
      reply: 'Please send a valid message.' 
    });
  }

  if (userMessage.length > 500) {
    return res.json({ 
      reply: 'Your message is too long. Please keep it under 500 characters.' 
    });
  }

  // Build user context from JWT if provided
  let userContext = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../config/environment');
      const token = authHeader.slice(7);
      const decoded = jwt.verify(token, JWT_SECRET);
      
      if (decoded?.id) {
        const userResult = await pool.query(
          'SELECT id, username, role, email FROM users WHERE id = $1',
          [decoded.id]
        );
        
        if (userResult.rows[0]) {
          userContext = {
            user: userResult.rows[0],
            isAdmin: userResult.rows[0].role === 'admin'
          };
        }
      }
    } catch (err) {
      // Invalid token - proceed without user context
      console.log('Chatbot: Invalid JWT provided, continuing as guest');
    }
  }

  try {
    const reply = await getResponse(userMessage, conversationId, userContext);
    res.json({ reply });
  } catch (error) {
    console.error('Chatbot error:', error);
    res.json({ reply: "I'm here to help with book recommendations and library navigation. What would you like to know?" });
  }
});

// Reset conversation context
router.post('/chat/reset', (req, res) => {
  const conversationId = req.body.conversationId || req.sessionID || 'default';
  conversations.delete(conversationId);
  res.json({ message: 'Conversation reset' });
});

module.exports = router;