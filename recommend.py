from flask import Flask, request, jsonify
import pandas as pd
import sqlite3
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel
import sys
import json

app = Flask(__name__)

# Function to fetch book data from SQLite database
def fetch_books():
    conn = sqlite3.connect('library.db')
    cursor = conn.cursor()
    cursor.execute('SELECT title, author, description, genres, cover FROM books')
    books = cursor.fetchall()
    conn.close()
    return books

# Function to convert book data to DataFrame
def books_to_df(books):
    df = pd.DataFrame(books, columns=['title', 'author', 'description', 'genres', 'cover'])
    df['content'] = df['title'] + ' ' + df['author'] + ' ' + df['description'] + ' ' + df['genres']
    return df

# Function to fetch user activity data from SQLite database
def fetch_user_activity(user_id):
    conn = sqlite3.connect('library.db')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT b.title, b.author, b.description, b.genres, b.cover
        FROM books b
        JOIN likes l ON b.id = l.bookId
        WHERE l.userId = ? AND l.action = 'like'
        UNION
        SELECT b.title, b.author, b.description, b.genres, b.cover
        FROM books b
        JOIN downloads d ON b.id = d.bookId
        WHERE d.userId = ?
        UNION
        SELECT b.title, b.author, b.description, b.genres, b.cover
        FROM books b
        JOIN searches s ON b.id = s.bookId
        WHERE s.userId = ?
    ''', (user_id, user_id, user_id))
    activity = cursor.fetchall()
    conn.close()
    return activity

# Update the recommendations function to use the dynamic data
@app.route('/recommendations', methods=['GET'])
def recommendations():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({"error": "User ID is required"}), 400

    try:
        user_id = int(user_id)  # Ensure user_id is an integer
    except ValueError:
        return jsonify({"error": "Invalid User ID"}), 400

    books = fetch_books()
    if not books:
        return jsonify({"error": "No books found"}), 404

    df = books_to_df(books)
    tfidf = TfidfVectorizer(stop_words='english')
    df['content'] = df['content'].fillna('')  # Fill NaN values with empty strings
    tfidf_matrix = tfidf.fit_transform(df['content'])

    user_activity = fetch_user_activity(user_id)
    if not user_activity:
        # If no user activity, return general recommendations (top 5 books)
        recommendations = df.sample(5).to_dict('records')
        return jsonify({"recommendations": recommendations})

    activity_df = books_to_df(user_activity)
    activity_df['content'] = activity_df['content'].fillna('')  # Handle missing values in the 'content' column
    activity_tfidf_matrix = tfidf.transform(activity_df['content'])
    activity_cosine_sim = linear_kernel(activity_tfidf_matrix, tfidf_matrix)

    sim_scores = activity_cosine_sim.mean(axis=0)
    sim_scores = list(enumerate(sim_scores))
    sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
    sim_scores = sim_scores[:5]  # Get the top 5 recommendations
    book_indices = [i[0] for i in sim_scores]
    recommendations = df.iloc[book_indices].to_dict('records')
    return jsonify({"recommendations": recommendations})

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--user_id', type=int, help='User ID')
    args = parser.parse_args()

    if args.user_id:
        # Run recommendation logic and print JSON
        user_id = args.user_id
        books = fetch_books()
        if not books:
            print(json.dumps({"recommendations": []}))
            sys.exit(0)
        df = books_to_df(books)
        tfidf = TfidfVectorizer(stop_words='english')
        df['content'] = df['content'].fillna('')
        tfidf_matrix = tfidf.fit_transform(df['content'])
        user_activity = fetch_user_activity(user_id)
        if not user_activity:
            recommendations = df.sample(5).to_dict('records')
            print(json.dumps({"recommendations": recommendations}))
            sys.exit(0)
        activity_df = books_to_df(user_activity)
        activity_df['content'] = activity_df['content'].fillna('')
        activity_tfidf_matrix = tfidf.transform(activity_df['content'])
        activity_cosine_sim = linear_kernel(activity_tfidf_matrix, tfidf_matrix)
        sim_scores = activity_cosine_sim.mean(axis=0)
        sim_scores = list(enumerate(sim_scores))
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
        sim_scores = sim_scores[:5]
        book_indices = [i[0] for i in sim_scores]
        recommendations = df.iloc[book_indices].to_dict('records')
        print(json.dumps({"recommendations": recommendations}))
        sys.exit(0)
    else:
        # Only print JSON error and exit if no user_id is provided
        print(json.dumps({"error": "No user_id provided"}))
        sys.exit(0)