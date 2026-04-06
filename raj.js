const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

(() => {
    const cliArgs = parseCLIArgs(process.argv.slice(2));
    const compareOldFileName = cliArgs.compareOldFile || cliArgs.oldFile;
    const compareNewFileName = cliArgs.newFile || null;
    const compareOnlyMode = Boolean(cliArgs.compareOnly);
    const showHelp = Boolean(cliArgs.help || cliArgs.h);

    if (showHelp) {
        printUsage();
        process.exit(0);
    }

    if (compareOnlyMode) {
        if (!compareOldFileName || !compareNewFileName) {
            console.error('❌ When using --compareOnly, please provide both --oldFile and --newFile.');
            printUsage();
            process.exit(1);
        }
        runComparisonOnly(compareOldFileName, compareNewFileName).catch(error => console.error('Comparison failed:', error.message));
    } else {
        getInfiniteRecords().catch(error => console.error('Scraping failed:', error.message));
    }
})();

function formatLocalTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function cleanupLegacyFiles() {
    const legacyPrefixes = ['sebi_fpi_infinite_', 'New_Record_', 'Old_Record_', 'sebi_diff_'];
    fs.readdirSync(__dirname)
      .filter(file => legacyPrefixes.some(prefix => file.startsWith(prefix)) && file.toLowerCase().endsWith('.json'))
      .forEach(file => {
          try {
              fs.unlinkSync(path.join(__dirname, file));
              console.log(`🧹 Removed legacy file: ${file}`);
          } catch (error) {
              console.warn(`⚠️ Failed to remove legacy file ${file}: ${error.message}`);
          }
      });
}

async function getInfiniteRecords() {
    cleanupLegacyFiles();
    const timestamp = formatLocalTimestamp();
    const allData = [];
    let currentPage = 1;
    let nextValue = 1;
    let doDirect = 0;
    const MIN_RECORDS_THRESHOLD = 25; // Stop when we get less than 25 records
    
    console.log(`🎯 Target: Fetch records until getting less than ${MIN_RECORDS_THRESHOLD} records in a single page\n`);
    console.log(`Starting with nextValue=${nextValue}, doDirect=${doDirect}\n`);
    
    let consecutiveSmallPages = 0;
    
    while (true) {
        console.log(`📄 Fetching page ${currentPage}...`);
        console.log(`   Using nextValue=${nextValue}, doDirect=${doDirect}`);
        
        const url = 'https://www.sebi.gov.in/sebiweb/ajax/other/getintmfpiinfo.jsp';
        
        const formData = new URLSearchParams();
        formData.append('nextValue', nextValue.toString());
        formData.append('next', 'n');
        formData.append('intmId', '16');
        formData.append('contPer', '');
        formData.append('name', '');
        formData.append('regNo', '');
        formData.append('email', '');
        formData.append('location', '');
        formData.append('exchange', '');
        formData.append('affiliate', '');
        formData.append('alp', '');
        formData.append('language', '2');
        formData.append('model', '');
        formData.append('esgCategory', '');
        formData.append('doDirect', doDirect.toString());
        formData.append('intmIds', '');
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Origin': 'https://www.sebi.gov.in',
                    'Referer': 'https://www.sebi.gov.in/sebiweb/other/OtherAction.do?doRecognisedFpi=yes&intmId=16'
                },
                body: formData
            });
            
            const htmlData = await response.text();
            const pageData = extractDataWithCheerio(htmlData);
            const recordsCount = pageData.length;
            
            if (recordsCount === 0) {
                console.log('❌ No more data available from server');
                break;
            }
            
            // Add all records from this page
            allData.push(...pageData);
            
            console.log(`   ✓ Found ${recordsCount} records on page ${currentPage}`);
            console.log(`   ✓ Total collected: ${allData.length} records so far`);
            
            // Check if we got less than the threshold
            if (recordsCount < MIN_RECORDS_THRESHOLD) {
                consecutiveSmallPages++;
                console.log(`   ⚠️ Got less than ${MIN_RECORDS_THRESHOLD} records (${recordsCount}) - Consecutive small pages: ${consecutiveSmallPages}`);
                
                // Stop if we get less than threshold
                if (consecutiveSmallPages >= 1) {
                    console.log(`\n🛑 Stopping: Received only ${recordsCount} records on page ${currentPage} (less than ${MIN_RECORDS_THRESHOLD})`);
                    break;
                }
            } else {
                consecutiveSmallPages = 0;
                console.log(`   ✓ Got ${recordsCount} records (>= ${MIN_RECORDS_THRESHOLD}), continuing...`);
            }
            
            // Auto-increment both values for next page
            nextValue++;
            doDirect++;
            currentPage++;
            
            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            console.error(`❌ Error fetching page ${currentPage}:`, error.message);
            break;
        }
    }
    
    // Save all collected records to JSON file
    if (allData.length > 0) {
        saveToJSONFile(allData, timestamp);
        console.log(`\n✨ Collection complete! Total records collected: ${allData.length}`);
    } else {
        console.log('❌ No data was collected');
    }
    
    return allData;
}

function extractDataWithCheerio(htmlString) {
    const $ = cheerio.load(htmlString);
    const finalData = [];
    
    // Select all tables with the specified class
    $('.fixed-table-body.card-table').each((index, table) => {
        const obj = {};
        
        // Find all card-view items within card-table-left
        $(table).find('.card-table-left .card-view').each((i, item) => {
            const title = $(item).find('.title span').text().trim();
            const value = $(item).find('.value span').text().trim();
            
            if (title) {
                obj[title] = value || '';
            }
        });
        
        // Add object to finalData if it has properties
        if (Object.keys(obj).length) {
            finalData.push(obj);
        }
    });
    
    return finalData;
}

function saveToJSONFile(data, timestamp) {
    // Create filename with timestamp
    const filename = `Sebi_Record_${timestamp}.json`;
    const filepath = path.join(__dirname, filename);
    
    // Create JSON with proper formatting
    const jsonContent = JSON.stringify({
        totalRecords: data.length,
        extractionDate: new Date().toISOString(),
        data: data
    }, null, 2);
    
    // Write to file
    fs.writeFileSync(filepath, jsonContent, 'utf8');
    console.log(`\n💾 Data saved to: ${filepath}`);
    console.log(`📊 Total records saved: ${data.length}`);
    
    // Display summary statistics
    if (data.length > 0) {
        console.log('\n📋 Sample of first 3 records:');
        console.log(JSON.stringify(data.slice(0, 3), null, 2));
        
        console.log('\n📑 Fields captured:');
        Object.keys(data[0]).forEach(field => {
            console.log(`   - ${field}`);
        });
        
        // Display last page summary
        console.log('\n📊 Collection Summary:');
        console.log(`   - Total pages fetched: ${Math.ceil(data.length / 25)} (estimated)`);
        console.log(`   - Stopped because last page had < 25 records`);
    }
}

async function compareFileContents(oldFilepath, newFilepath, timestamp) {
    const rawOldContent = loadJSONFile(oldFilepath);
    const rawNewContent = loadJSONFile(newFilepath);
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
        throw new Error('Both files must contain either a root array or a top-level "data" array');
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
                updated.push({
                    key,
                    old: oldRecord,
                    new: record,
                    changes
                });
            }
        }
    });

    oldContent.forEach(record => {
        const key = getRecordKey(record);
        if (!newIndex.has(key)) {
            removed.push(record);
        }
    });

    const diffData = {
        generatedAt: new Date().toISOString(),
        oldFile: path.basename(oldFilepath),
        newFile: path.basename(newFilepath),
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

    const diffFilename = `sebi_diff_${timestamp}.json`;
    const diffFilepath = path.join(__dirname, diffFilename);
    fs.writeFileSync(diffFilepath, JSON.stringify(diffData, null, 2), 'utf8');

    console.log(`💾 Comparison result saved to: ${diffFilepath}`);
    console.log(`   - Added: ${added.length}`);
    console.log(`   - Removed: ${removed.length}`);
    console.log(`   - Updated: ${updated.length}`);
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

function parseCLIArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
                options[key] = argv[i + 1];
                i++; // Skip the next arg
            } else {
                options[key] = true;
            }
        }
    }
    return options;
}

function printUsage() {
    console.log('\nUsage: node raj.js [options]\n');
    console.log('Options:');
    console.log('  --compareOldFile=<filename>   Compare generated file against this old file');
    console.log('  --oldFile=<filename>          Alias for --compareOldFile');
    console.log('  --newFile=<filename>          When using --compareOnly, compare this new file');
    console.log('  --compareOnly                 Compare two existing files and skip scraping');
    console.log('  --help, --h                   Show this help message');
    console.log('\nOutput:');
    console.log('  On normal run, the script generates a single JSON file named');
    console.log('  Sebi_Record_<YYYY-MM-DD_HH-mm-ss>.json');
}

async function runComparisonOnly(oldFileName, newFileName) {
    const timestamp = formatLocalTimestamp();
    const oldFilepath = path.join(__dirname, path.basename(oldFileName));
    const newFilepath = path.join(__dirname, path.basename(newFileName));

    if (!fs.existsSync(oldFilepath)) {
        console.error(`❌ Old file not found: ${oldFilepath}`);
        process.exit(1);
    }
    if (!fs.existsSync(newFilepath)) {
        console.error(`❌ New file not found: ${newFilepath}`);
        process.exit(1);
    }

    await compareFileContents(oldFilepath, newFilepath, timestamp);
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
            changes[field] = {
                old: oldValue,
                new: newValue
            };
        }
    });
    return changes;
}

async function exportAddedRecordsToExcel(addedRecords, timestamp) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Added Records');

    // If there are no records, return early
    if (!addedRecords || addedRecords.length === 0) {
        return;
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

    // Save the Excel file
    const excelFilename = `sebi_added_records_${timestamp}.xlsx`;
    const excelFilepath = path.join(__dirname, excelFilename);

    await workbook.xlsx.writeFile(excelFilepath);
    console.log(`📊 Excel export saved to: ${excelFilepath}`);
    console.log(`   - Exported ${addedRecords.length} added records`);
}
