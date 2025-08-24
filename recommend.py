from flask import Flask, request, jsonify
import pandas as pd
import psycopg2
import os
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel
import sys
import json

app = Flask(__name__)

def get_pg_conn():
    db_url = os.environ.get('DATABASE_URL_LOCAL') or os.environ.get('DATABASE_URL') or 'postgresql://postgres:yourpassword@localhost:5432/your_local_db'
    return psycopg2.connect(db_url)

# Function to fetch book data from Postgres database
def fetch_books():
    conn = get_pg_conn()
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

# Function to fetch user activity data from Postgres database
def fetch_user_activity(user_id):
    conn = get_pg_conn()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT b.title, b.author, b.description, b.genres, b.cover
        FROM books b
        JOIN likes l ON b.id = l.bookid
        WHERE l.userid = %s AND l.action = 'like'
        -- If you have downloads/searches tables in Postgres, add similar JOINs here
    ''', (user_id,))
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
        # If no user activity, return general recommendations (up to 5 books)
        n = min(5, len(df))
        recommendations = df.sample(n).to_dict('records') if n > 0 else []
        return jsonify({"recommendations": recommendations})

    activity_df = books_to_df(user_activity)
    activity_df['content'] = activity_df['content'].fillna('')  # Handle missing values in the 'content' column
    activity_tfidf_matrix = tfidf.transform(activity_df['content'])
    activity_cosine_sim = linear_kernel(activity_tfidf_matrix, tfidf_matrix)

    sim_scores = activity_cosine_sim.mean(axis=0)
    sim_scores = list(enumerate(sim_scores))
    sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
    n = min(5, len(sim_scores))
    sim_scores = sim_scores[:n]  # Get up to top 5 recommendations
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
            n = min(5, len(df))
            recommendations = df.sample(n).to_dict('records') if n > 0 else []
            print(json.dumps({"recommendations": recommendations}))
            sys.exit(0)
        activity_df = books_to_df(user_activity)
        activity_df['content'] = activity_df['content'].fillna('')
        activity_tfidf_matrix = tfidf.transform(activity_df['content'])
        activity_cosine_sim = linear_kernel(activity_tfidf_matrix, tfidf_matrix)
        sim_scores = activity_cosine_sim.mean(axis=0)
        sim_scores = list(enumerate(sim_scores))
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
        n = min(5, len(sim_scores))
        sim_scores = sim_scores[:n]
        book_indices = [i[0] for i in sim_scores]
        recommendations = df.iloc[book_indices].to_dict('records')
        print(json.dumps({"recommendations": recommendations}))
        sys.exit(0)
    else:
        # Only print JSON error and exit if no user_id is provided
        print(json.dumps({"error": "No user_id provided"}))
        sys.exit(0)