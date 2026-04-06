const fs = require('fs');
const path = require('path');

function sendJSON(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
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
  records.forEach((rec) => {
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
  fieldSet.forEach((field) => {
    const oldValue = oldRecord[field] === undefined ? null : oldRecord[field];
    const newValue = newRecord[field] === undefined ? null : newRecord[field];
    if (oldValue !== newValue) {
      changes[field] = { old: oldValue, new: newValue };
    }
  });
  return changes;
}

function resolveDataFile(rootDir, name) {
  const filename = path.basename(String(name || ''));
  if (!filename.toLowerCase().endsWith('.json')) {
    throw new Error('Only .json files are allowed');
  }
  const filepath = path.join(rootDir, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filename}`);
  }
  return { filename, filepath };
}

function normalizeRecords(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  return null;
}

function compareFiles(rootDir, oldName, newName) {
  const old = resolveDataFile(rootDir, oldName);
  const neu = resolveDataFile(rootDir, newName);

  const rawOldContent = loadJSONFile(old.filepath);
  const rawNewContent = loadJSONFile(neu.filepath);

  const oldContent = normalizeRecords(rawOldContent);
  const newContent = normalizeRecords(rawNewContent);

  if (!Array.isArray(oldContent) || !Array.isArray(newContent)) {
    throw new Error('Both JSON files must contain either a root array or a top-level "data" array.');
  }

  const oldIndex = createRecordIndex(oldContent);
  const newIndex = createRecordIndex(newContent);
  const added = [];
  const removed = [];
  const updated = [];

  newContent.forEach((record) => {
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

  oldContent.forEach((record) => {
    const key = getRecordKey(record);
    if (!newIndex.has(key)) {
      removed.push(record);
    }
  });

  return {
    oldFile: old.filename,
    newFile: neu.filename,
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

module.exports = (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const oldFile = url.searchParams.get('oldFile');
  const newFile = url.searchParams.get('newFile');
  if (!oldFile || !newFile) {
    sendJSON(res, { error: 'oldFile and newFile query parameters are required' }, 400);
    return;
  }

  try {
    const rootDir = path.resolve(__dirname, '..');
    const diffResult = compareFiles(rootDir, oldFile, newFile);
    sendJSON(res, diffResult, 200);
  } catch (error) {
    sendJSON(res, { error: error?.message || 'Compare failed' }, 400);
  }
};
