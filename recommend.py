from flask import Flask, request, jsonify
import pandas as pd
import psycopg2
import os
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity, linear_kernel
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import TruncatedSVD
import sys
import json
import logging
from datetime import datetime, timedelta
import re

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

class ImprovedRecommendationSystem:
    def __init__(self):
        self.tfidf = TfidfVectorizer(
            stop_words='english',
            max_features=5000,
            ngram_range=(1, 2),  # Include bigrams for better context
            min_df=2,  # Ignore very rare terms
            max_df=0.8  # Ignore very common terms
        )
        self.scaler = StandardScaler()
        self.svd = TruncatedSVD(n_components=50, random_state=42)
        
    def get_pg_conn(self):
        """Enhanced database connection with error handling"""
        try:
            db_url = (
                os.environ.get('DATABASE_URL_LOCAL') or 
                os.environ.get('DATABASE_URL') or 
                'postgresql://postgres:yourpassword@localhost:5432/your_local_db'
            )
            conn = psycopg2.connect(db_url)
            return conn
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            raise
    
    def fetch_books_enhanced(self):
        """Fetch books with additional metadata"""
        conn = self.get_pg_conn()
        try:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT 
                    id,
                    title, 
                    author, 
                    description, 
                    genres, 
                    cover,
                    COALESCE(likes, 0) as likes,
                    COALESCE(dislikes, 0) as dislikes,
                    COALESCE(averageRating, 0) as avg_rating
                FROM books 
                WHERE title IS NOT NULL AND author IS NOT NULL
            ''')
            books = cursor.fetchall()
            return books
        finally:
            conn.close()
    
    def fetch_user_comprehensive_activity(self, user_id):
        """Fetch comprehensive user activity including ratings and reviews"""
        conn = self.get_pg_conn()
        try:
            cursor = conn.cursor()
            
            # Get liked books with timestamps if available
            cursor.execute('''
                SELECT 
                    b.id,
                    b.title, 
                    b.author, 
                    b.description, 
                    b.genres, 
                    b.cover,
                    l.action,
                    COALESCE(b.averageRating, 0) as avg_rating
                FROM books b
                JOIN likes l ON b.id = l.bookid
                WHERE l.userid = %s
            ''', (user_id,))
            likes_data = cursor.fetchall()
            
            # Get user reviews/ratings
            cursor.execute('''
                SELECT 
                    b.id,
                    b.title, 
                    b.author, 
                    b.description, 
                    b.genres, 
                    b.cover,
                    r.rating,
                    COALESCE(b.averageRating, 0) as avg_rating
                FROM books b
                JOIN reviews r ON b.id = r.bookId
                WHERE r.userId = %s
            ''', (user_id,))
            reviews_data = cursor.fetchall()
            
            # Get user profile preferences
            cursor.execute('''
                SELECT favoriteGenres, favoriteAuthors, favoriteBooks
                FROM users WHERE id = %s
            ''', (user_id,))
            profile_data = cursor.fetchone()
            
            return likes_data, reviews_data, profile_data
        finally:
            conn.close()
    
    def preprocess_text(self, text):
        """Clean and preprocess text data"""
        if pd.isna(text) or text is None:
            return ""
        
        # Convert to lowercase and remove special characters
        text = str(text).lower()
        text = re.sub(r'[^\w\s]', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        
        return text
    
    def create_enhanced_features(self, df):
        """Create enhanced feature matrix combining multiple signals"""
        # Text features
        content_features = []
        for _, row in df.iterrows():
            content = f"{row['title']} {row['author']} {row['description']} {row['genres']}"
            content_features.append(self.preprocess_text(content))
        
        # TF-IDF features
        tfidf_matrix = self.tfidf.fit_transform(content_features)
        
        # Numerical features (popularity, rating)
        numerical_features = df[['likes', 'avg_rating']].fillna(0)
        numerical_scaled = self.scaler.fit_transform(numerical_features)
        
        # Combine features
        combined_features = np.hstack([
            tfidf_matrix.toarray(),
            numerical_scaled
        ])
        
        return combined_features
    
    def calculate_user_profile(self, user_activity, books_df):
        """Build comprehensive user profile from activity"""
        if not user_activity:
            return None
        
        # Separate likes and dislikes
        liked_books = []
        disliked_books = []
        rated_books = []
        
        likes_data, reviews_data, profile_data = user_activity
        
        # Process likes/dislikes
        for book_data in likes_data:
            book_info = {
                'id': book_data[0],
                'title': book_data[1],
                'author': book_data[2],
                'description': book_data[3],
                'genres': book_data[4],
                'action': book_data[6],
                'avg_rating': book_data[7]
            }
            
            if book_data[6] == 'like':
                liked_books.append(book_info)
            else:
                disliked_books.append(book_info)
        
        # Process ratings/reviews
        for review_data in reviews_data:
            rated_books.append({
                'id': review_data[0],
                'title': review_data[1],
                'author': review_data[2],
                'description': review_data[3],
                'genres': review_data[4],
                'rating': review_data[6],
                'avg_rating': review_data[7]
            })
        
        return {
            'liked_books': liked_books,
            'disliked_books': disliked_books,
            'rated_books': rated_books,
            'profile_preferences': profile_data
        }
    
    def get_content_based_recommendations(self, user_profile, books_df, combined_features, n_recommendations=10):
        """Generate content-based recommendations with negative feedback"""
        if not user_profile or not user_profile['liked_books']:
            return []
        
        # Get indices of liked and disliked books
        liked_indices = []
        disliked_indices = []
        
        for liked_book in user_profile['liked_books']:
            matching_books = books_df[books_df['id'] == liked_book['id']]
            if not matching_books.empty:
                liked_indices.append(matching_books.index[0])
        
        for disliked_book in user_profile['disliked_books']:
            matching_books = books_df[books_df['id'] == disliked_book['id']]
            if not matching_books.empty:
                disliked_indices.append(matching_books.index[0])
        
        if not liked_indices:
            return []
        
        # Calculate similarity scores
        cosine_sim = cosine_similarity(combined_features)
        
        # Get similarity scores for liked books
        liked_sim_scores = np.mean(cosine_sim[liked_indices], axis=0)
        
        # Penalize books similar to disliked ones
        if disliked_indices:
            disliked_sim_scores = np.mean(cosine_sim[disliked_indices], axis=0)
            # Subtract disliked similarity with lower weight
            final_scores = liked_sim_scores - 0.3 * disliked_sim_scores
        else:
            final_scores = liked_sim_scores
        
        # Get top recommendations
        sim_scores = list(enumerate(final_scores))
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
        
        # Filter out books user has already interacted with
        interacted_ids = set()
        for book in user_profile['liked_books'] + user_profile['disliked_books']:
            interacted_ids.add(book['id'])
        
        recommendations = []
        for idx, score in sim_scores:
            if books_df.iloc[idx]['id'] not in interacted_ids:
                book_rec = books_df.iloc[idx].to_dict()
                book_rec['similarity_score'] = float(score)
                recommendations.append(book_rec)
                
                if len(recommendations) >= n_recommendations:
                    break
        
        return recommendations
    
    def get_popularity_based_recommendations(self, books_df, n_recommendations=5):
        """Fallback popularity-based recommendations"""
        # Calculate popularity score combining likes and ratings
        books_df['popularity_score'] = (
            books_df['likes'] * 0.4 + 
            books_df['avg_rating'] * books_df['likes'] * 0.6
        )
        
        top_books = books_df.nlargest(n_recommendations, 'popularity_score')
        return top_books.to_dict('records')
    
    def diversify_recommendations(self, recommendations, diversity_factor=0.3):
        """Add diversity to recommendations to avoid over-clustering"""
        if len(recommendations) <= 3:
            return recommendations
        
        # Simple diversity by author - avoid too many books by same author
        diversified = []
        author_count = {}
        
        for book in recommendations:
            author = book.get('author', 'Unknown')
            current_count = author_count.get(author, 0)
            
            # Limit books per author based on diversity factor
            max_per_author = max(1, int(len(recommendations) * diversity_factor))
            
            if current_count < max_per_author:
                diversified.append(book)
                author_count[author] = current_count + 1
        
        return diversified
    
    def get_recommendations(self, user_id, current_book_id=None, n_recommendations=5):
        """Main recommendation function with comprehensive logic"""
        try:
            # Fetch all books
            books_data = self.fetch_books_enhanced()
            if not books_data:
                logger.warning("No books found in database")
                return {"recommendations": []}
            
            # Create DataFrame
            books_df = pd.DataFrame(books_data, columns=[
                'id', 'title', 'author', 'description', 'genres', 
                'cover', 'likes', 'dislikes', 'avg_rating'
            ])
            
            # Remove current book if specified
            if current_book_id:
                books_df = books_df[books_df['id'] != int(current_book_id)]
            
            # Get user activity
            user_activity = self.fetch_user_comprehensive_activity(user_id)
            user_profile = self.calculate_user_profile(user_activity, books_df)
            
            # Generate recommendations
            if user_profile and (user_profile['liked_books'] or user_profile['rated_books']):
                # Content-based recommendations for active users
                combined_features = self.create_enhanced_features(books_df)
                recommendations = self.get_content_based_recommendations(
                    user_profile, books_df, combined_features, n_recommendations * 2
                )
                
                # Add diversity
                recommendations = self.diversify_recommendations(recommendations)
                
                # If we don't have enough, supplement with popular books
                if len(recommendations) < n_recommendations:
                    popular_recs = self.get_popularity_based_recommendations(
                        books_df, n_recommendations - len(recommendations)
                    )
                    
                    # Avoid duplicates
                    existing_ids = {rec['id'] for rec in recommendations}
                    for pop_rec in popular_recs:
                        if pop_rec['id'] not in existing_ids:
                            recommendations.append(pop_rec)
                
            else:
                # New user - popularity-based recommendations
                recommendations = self.get_popularity_based_recommendations(
                    books_df, n_recommendations
                )
            
            # Limit to requested number
            recommendations = recommendations[:n_recommendations]
            
            # Clean up recommendations for JSON serialization
            for rec in recommendations:
                for key, value in rec.items():
                    if pd.isna(value):
                        rec[key] = None
                    elif isinstance(value, np.float64):
                        rec[key] = float(value)
                    elif isinstance(value, np.int64):
                        rec[key] = int(value)
            
            logger.info(f"Generated {len(recommendations)} recommendations for user {user_id}")
            return {"recommendations": recommendations}
            
        except Exception as e:
            logger.error(f"Error generating recommendations for user {user_id}: {e}")
            return {"recommendations": [], "error": str(e)}

# Initialize the recommendation system
rec_system = ImprovedRecommendationSystem()

@app.route('/recommendations', methods=['GET'])
def recommendations():
    user_id = request.args.get('user_id')
    current_book_id = request.args.get('current_book_id')
    
    if not user_id:
        return jsonify({"error": "User ID is required"}), 400

    try:
        user_id = int(user_id)
    except ValueError:
        return jsonify({"error": "Invalid User ID"}), 400

    result = rec_system.get_recommendations(user_id, current_book_id)
    return jsonify(result)

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--user_id', type=int, help='User ID')
    parser.add_argument('--current_book_id', type=int, help='Current book ID to exclude')
    args = parser.parse_args()

    if args.user_id:
        result = rec_system.get_recommendations(args.user_id, args.current_book_id)
        print(json.dumps(result))
    else:
        print(json.dumps({"error": "No user_id provided"}))