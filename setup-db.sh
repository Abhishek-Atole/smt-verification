#!/bin/bash
sudo -u postgres psql << EOF
-- Create the database if it doesn't exist
CREATE DATABASE smtverification WITH OWNER = smtverify;

-- Connect to the database and create the users table
\c smtverification
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL
);

-- Insert the default users with proper password hashing
INSERT INTO users (username, password, role) VALUES 
  ('operator1', '\$2a\$12\$examplehash', 'operator'),
  ('qa1', '\$2a\$12\$examplehash', 'qa'),
  ('engineer1', '\$2a\$12\$examplehash', 'engineer')
ON CONFLICT (username) DO UPDATE SET 
  password = EXCLUDED.password, 
  role = EXCLUDED.role;

-- Create the users table properly
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL
);
EOF