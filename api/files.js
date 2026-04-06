const fs = require('fs');
const path = require('path');

function listJsonFiles(rootDir) {
  return fs
    .readdirSync(rootDir)
    .filter((file) => file.startsWith('Sebi_Record') && file.toLowerCase().endsWith('.json'))
    .sort();
}

module.exports = (req, res) => {
  try {
    const rootDir = path.resolve(__dirname, '..');
    const files = listJsonFiles(rootDir);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ files }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: error?.message || 'Failed to list files' }));
  }
};
