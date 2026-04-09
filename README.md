# EduTrack — Student Result Management System

A full-stack web app with 3 user roles, MySQL database, and PDF report generation.

## Project Structure
```
student-result-app/
├── frontend/
│   └── index.html       ← Single-page app (all pages in one file)
└── backend/
    ├── server.js        ← Express API + session auth
    ├── package.json
    └── .env.example     ← Copy to .env and fill in your values
```

## Modules
1. **Login / Register** — Role-based auth (Student, Teacher, Admin)
2. **Student Dashboard** — View own grades, download PDF report card
3. **Teacher Dashboard** — Enter/update grades, manage subjects, view all students
4. **Admin Dashboard** — Manage all users, view all results

## Local Setup

### 1. Create MySQL database
In MySQL Workbench:
```sql
CREATE DATABASE student_results;
```

### 2. Configure .env
```bash
cd backend
cp .env.example .env
# Edit .env with your MySQL password
```

### 3. Run the app
```bash
npm install
node server.js
```

Open: **http://localhost:3000**

### Default Admin Login
- Email: `admin@school.com`
- Password: `admin123`

## AWS Deployment
Follow the same steps as the Todo app deployment guide — EC2 for backend, RDS for MySQL.
Just change `DB_NAME=student_results` in your `.env`.
# trigger
