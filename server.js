const express = require('express');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'src')));

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        message: 'TikTok HQ Upload Web App is running'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`TikTok HQ Upload Web App running on http://localhost:${PORT}`);
    console.log(`Press Ctrl+C to stop the server`);
});