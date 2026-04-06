const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const ExcelJS = require('exceljs');

const PORT = process.env.PORT || 3000;
const rootDir = __dirname;

function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

function sendText(res, text, type = 'text/plain', status = 200) {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
  res.end(text);
}

function serveFile(res, filename, contentType) {
  const filePath = path.join(rootDir, filename);
  if (!fs.existsSync(filePath)) {
    sendText(res, 'Not found', 'text/plain', 404);
    return;
  }
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(content);
}

function listJsonFiles() {
  return fs.readdirSync(rootDir)
    .filter(file => file.startsWith('Sebi_Record') && file.toLowerCase().endsWith('.json'))
    .sort();
}

function loadJSONFile(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  return JSON.parse(content);
}

function getRecordKey(record) {
  if (!record || typeof record !== 'object') return '';
  const registration = record['Registration No.'] || record['Registration No'] || record['RegNo'];
  if (registration && typeof registration === 'string' && registration.trim()) {
    return registration.trim().toLowerCase();
  }
  const name = record['Name'];
  return typeof name === 'string' ? name.trim().toLowerCase() : JSON.stringify(record);
}

function createRecordIndex(records) {
  const index = new Map();
  records.forEach(rec => {
    const key = getRecordKey(rec);
    if (key && !index.has(key)) {
      index.set(key, rec);
    }
  });
  return index;
}

function diffRecordFields(oldRecord, newRecord) {
  const changes = {};
  const fieldSet = new Set([...Object.keys(oldRecord || {}), ...Object.keys(newRecord || {})]);
  fieldSet.forEach(field => {
    const oldValue = oldRecord[field] === undefined ? null : oldRecord[field];
    const newValue = newRecord[field] === undefined ? null : newRecord[field];
    if (oldValue !== newValue) {
      changes[field] = { old: oldValue, new: newValue };
    }
  });
  return changes;
}

async function generateExcelBuffer(addedRecords) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Added Records');

  // If there are no records, return empty buffer
  if (!addedRecords || addedRecords.length === 0) {
    return await workbook.xlsx.writeBuffer();
  }

  // Get all unique field names from all records
  const allFields = new Set();
  addedRecords.forEach(record => {
    Object.keys(record).forEach(field => allFields.add(field));
  });

  // Convert Set to sorted array for consistent column order
  const fieldNames = Array.from(allFields).sort();

  // Add headers
  worksheet.columns = fieldNames.map(field => ({
    header: field,
    key: field,
    width: Math.max(field.length, 15) // Minimum width of 15, or field name length
  }));

  // Add data rows
  addedRecords.forEach(record => {
    const rowData = {};
    fieldNames.forEach(field => {
      rowData[field] = record[field] || '';
    });
    worksheet.addRow(rowData);
  });

  // Style the header row
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE6E6FA' } // Light lavender background
  };

  return await workbook.xlsx.writeBuffer();
}

function compareFiles(oldName, newName) {
  const oldPath = path.join(rootDir, path.basename(oldName));
  const newPath = path.join(rootDir, path.basename(newName));

  if (!fs.existsSync(oldPath)) {
    throw new Error(`Old file not found: ${oldName}`);
  }
  if (!fs.existsSync(newPath)) {
    throw new Error(`New file not found: ${newName}`);
  }

  const rawOldContent = loadJSONFile(oldPath);
  const rawNewContent = loadJSONFile(newPath);

  const oldContent = Array.isArray(rawOldContent)
    ? rawOldContent
    : Array.isArray(rawOldContent?.data)
      ? rawOldContent.data
      : null;

  const newContent = Array.isArray(rawNewContent)
    ? rawNewContent
    : Array.isArray(rawNewContent?.data)
      ? rawNewContent.data
      : null;

  if (!Array.isArray(oldContent) || !Array.isArray(newContent)) {
    throw new Error('Both JSON files must contain either a root array or a top-level "data" array.');
  }

  const oldIndex = createRecordIndex(oldContent);
  const newIndex = createRecordIndex(newContent);
  const added = [];
  const removed = [];
  const updated = [];

  newContent.forEach(record => {
    const key = getRecordKey(record);
    const oldRecord = oldIndex.get(key);
    if (!oldRecord) {
      added.push(record);
    } else {
      const changes = diffRecordFields(oldRecord, record);
      if (Object.keys(changes).length > 0) {
        updated.push({ key, old: oldRecord, new: record, changes });
      }
    }
  });

  oldContent.forEach(record => {
    const key = getRecordKey(record);
    if (!newIndex.has(key)) {
      removed.push(record);
    }
  });

  return {
    oldFile: oldName,
    newFile: newName,
    counts: {
      oldRecords: oldContent.length,
      newRecords: newContent.length,
      added: added.length,
      removed: removed.length,
      updated: updated.length
    },
    added,
    removed,
    updated
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/') {
    const publicIndex = path.join('public', 'index.html');
    if (fs.existsSync(path.join(rootDir, publicIndex))) {
      serveFile(res, publicIndex, 'text/html');
    } else {
      serveFile(res, 'compare-ui.html', 'text/html');
    }
    return;
  }

  if (url.pathname === '/files') {
    sendJSON(res, { files: listJsonFiles() });
    return;
  }

  if (url.pathname === '/compare') {
    const oldFile = url.searchParams.get('oldFile');
    const newFile = url.searchParams.get('newFile');
    if (!oldFile || !newFile) {
      sendJSON(res, { error: 'oldFile and newFile query parameters are required' }, 400);
      return;
    }

    try {
      const diffResult = compareFiles(oldFile, newFile);
      
      // Save the diff result to a file for Excel download
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const diffFilename = `sebi_diff_${timestamp}.json`;
      const diffFilepath = path.join(rootDir, diffFilename);
      fs.writeFileSync(diffFilepath, JSON.stringify(diffResult, null, 2), 'utf8');
      
      // Add the diff filename to the response
      diffResult.diffFile = diffFilename;
      
      sendJSON(res, diffResult);
    } catch (error) {
      sendJSON(res, { error: error.message }, 400);
    }
    return;
  }

  if (url.pathname === '/run-scraper' && req.method === 'POST') {
    console.log('🔄 Starting scraper via UI...');
    exec('node raj.js', { cwd: rootDir }, (error, stdout, stderr) => {
      if (error) {
        console.error('Scraper error:', error);
        sendJSON(res, { error: `Scraper failed: ${error.message}` }, 500);
        return;
      }
      if (stderr) {
        console.warn('Scraper stderr:', stderr);
      }
      console.log('✅ Scraper completed successfully');
      sendJSON(res, { success: true, message: 'New records generated successfully', output: stdout });
    });
    return;
  }

  if (url.pathname === '/download-excel') {
    try {
      const diffFile = url.searchParams.get('diffFile');
      const oldFile = url.searchParams.get('oldFile');
      const newFile = url.searchParams.get('newFile');

      let addedRecords = [];

      if (diffFile) {
        const diffPath = path.join(rootDir, path.basename(diffFile));
        if (!fs.existsSync(diffPath)) {
          sendJSON(res, { error: `Diff file not found: ${diffFile}` }, 404);
          return;
        }
        const diffData = loadJSONFile(diffPath);
        addedRecords = diffData.added || [];
      } else if (oldFile && newFile) {
        const diffResult = compareFiles(oldFile, newFile);
        addedRecords = diffResult.added || [];
      } else {
        sendJSON(res, { error: 'Either diffFile or (oldFile and newFile) query parameters are required' }, 400);
        return;
      }

      generateExcelBuffer(addedRecords).then(buffer => {
        const filename = `sebi_added_records_${Date.now()}.xlsx`;
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store'
        });
        res.end(buffer);
      }).catch(error => {
        console.error('Excel generation error:', error);
        sendJSON(res, { error: 'Failed to generate Excel file' }, 500);
      });
    } catch (error) {
      sendJSON(res, { error: error.message }, 400);
    }
    return;
  }

  sendText(res, 'Not found', 'text/plain', 404);
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`🚀 UI server running at http://localhost:${port}`);
    console.log('📄 Open compare-ui.html in your browser or visit the URL above.');
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`⚠️ Port ${port} is already in use. Trying ${nextPort} instead...`);
      startServer(nextPort);
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

startServer(PORT);
