const express = require('express');
const router = express.Router();

// In-memory conversation context (simple implementation)
const conversations = new Map();

// Library knowledge base with contextual responses
const responses = {
  greeting: [
    "Hello! I'm LibBot, your Des2 Library assistant. I can help you find books by genre, author, or give recommendations. What interests you?",
    "Hi! Welcome to Des2 Library. Looking for a specific genre or need a book recommendation?"
  ],
  
  fiction_recommendations: [
    "Great choice! For Fiction, I recommend checking out our highly-rated titles. Popular fiction genres in our library include Literary Fiction, Contemporary Fiction, and Historical Fiction. You can search by 'Fiction' in the genre filter to see all available titles!",
    "Fiction is a popular choice! Browse our Fiction section using the genre search. Look for books with high ratings - our users love contemporary and literary fiction!",
    "Perfect! We have excellent Fiction books. Use the search bar and type 'Fiction' in the genre field to explore our collection. Check the ratings to find reader favorites!"
  ],
  
  mystery_recommendations: [
    "Mystery lovers rejoice! Search for 'Mystery' or 'Thriller' in the genre filter. Our top-rated mystery books are usually bestsellers. Don't miss the ones with 4+ star ratings!",
    "Great choice! Our Mystery section has detective stories, crime fiction, and psychological thrillers. Filter by 'Mystery' genre to see them all."
  ],
  
  romance_recommendations: [
    "Romance novels are very popular! Search 'Romance' in the genre filter to find contemporary romance, historical romance, and romantic comedy titles.",
    "Looking for love stories? Filter by 'Romance' genre to discover heartwarming tales and page-turners!"
  ],
  
  scifi_recommendations: [
    "Sci-Fi fans will love our collection! Search for 'Science Fiction' or 'Sci-Fi' in the genre filter. We have space operas, dystopian futures, and time travel adventures!",
    "Science Fiction is exciting! Use the genre search for 'Science Fiction' to explore futuristic worlds and advanced technology stories."
  ],
  
  fantasy_recommendations: [
    "Fantasy awaits! Search 'Fantasy' in the genre field to find epic adventures, magical worlds, and mythical creatures. High-rated fantasy books are reader favorites!",
    "Great genre! Our Fantasy section includes high fantasy, urban fantasy, and magical realism. Filter by 'Fantasy' to see them all."
  ],
  
  genre_question: [
    "We have many genres: Fiction, Mystery, Romance, Science Fiction, Fantasy, Non-Fiction, Biography, History, Self-Help, Thriller, and more! Which one interests you?",
    "Our library includes Fiction, Mystery, Romance, Sci-Fi, Fantasy, Biography, History, and many other genres. What would you like to explore?"
  ],
  
  search_help: [
    "To search for books: Use the search bar on the main page. You can search by title, author name, or genre. Try different combinations to find what you want!",
    "Searching is easy! On the main books page, enter a title, author, or genre in the search fields. You can use one or all three filters together."
  ],
  
  download_help: [
    "To download: 1) Find a book you like, 2) Click on it to view details, 3) Click the green 'Download' button. Make sure you're logged in!",
    "Downloading books: Click any book to see its details page, then click the Download button. You must be logged in to download."
  ],
  
  default: [
    "I can help you with book recommendations, genre searches, or navigation tips. What would you like to know?",
    "Ask me about specific genres (Fiction, Mystery, Romance, Sci-Fi, Fantasy), search tips, or how to download books!",
    "I'm here to help! Try asking about book genres, how to search, or for recommendations based on what you like to read."
  ]
};

function getResponse(message, conversationId) {
  const msg = message.toLowerCase().trim();
  
  // Get conversation history
  let context = conversations.get(conversationId) || [];
  const lastMessage = context[context.length - 1] || '';
  
  // Update context
  context.push(msg);
  if (context.length > 5) context.shift(); // Keep last 5 messages
  conversations.set(conversationId, context);
  
  // Greeting
  if (/^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|sup|yo)/.test(msg)) {
    return random(responses.greeting);
  }
  
  // Genre-specific recommendations
  if (/fiction/i.test(msg) && (lastMessage.includes('recommend') || lastMessage.includes('genre') || /recommend|suggest|want|looking|need/.test(msg))) {
    return random(responses.fiction_recommendations);
  }
  
  if (/(mystery|thriller|detective|crime)/i.test(msg)) {
    return random(responses.mystery_recommendations);
  }
  
  if (/romance/i.test(msg)) {
    return random(responses.romance_recommendations);
  }
  
  if (/(sci-fi|science fiction|scifi)/i.test(msg)) {
    return random(responses.scifi_recommendations);
  }
  
  if (/fantasy/i.test(msg)) {
    return random(responses.fantasy_recommendations);
  }
  
  // General recommendation request
  if (/(recommend|suggest|good book|what.*read|book.*for|looking for)/i.test(msg)) {
    return random(responses.genre_question);
  }
  
  // Genre inquiry
  if (/(genre|category|type|what.*have|what.*available|sections)/i.test(msg)) {
    return random(responses.genre_question);
  }
  
  // Search help
  if (/(how.*search|find.*book|where.*look|search)/i.test(msg)) {
    return random(responses.search_help);
  }
  
  // Download help
  if (/(download|get.*book|how.*get)/i.test(msg)) {
    return random(responses.download_help);
  }
  
  // Default response
  return random(responses.default);
}

function random(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Chat endpoint
router.post('/chat', async (req, res) => {
  const userMessage = req.body.message;
  const conversationId = req.sessionID || 'default';
  
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

  try {
    const reply = getResponse(userMessage, conversationId);
    res.json({ reply });
  } catch (error) {
    console.error('Error:', error);
    res.json({ reply: "I'm here to help with book recommendations and library navigation. What would you like to know?" });
  }
});

// Clear conversation context (optional endpoint)
router.post('/chat/reset', (req, res) => {
  const conversationId = req.sessionID || 'default';
  conversations.delete(conversationId);
  res.json({ message: 'Conversation reset' });
});

// Health check
router.get('/chat/health', (req, res) => {
  res.json({
    status: 'ready',
    mode: 'contextual_pattern_matching',
    active_conversations: conversations.size,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
