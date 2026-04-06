const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

async function get100Records() {
    const allData = [];
    let currentPage = 1;
    let nextValue = 1;  // Starting value from your original code
    let doDirect = 0;   // Starting value from your original code
    const targetRecords = 100;
    
    console.log(`🎯 Target: Fetch ${targetRecords} records\n`);
    console.log(`Starting with nextValue=${nextValue}, doDirect=${doDirect}\n`);
    
    while (allData.length < targetRecords) {
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
            
            if (pageData.length === 0) {
                console.log('❌ No more data available from server');
                break;
            }
            
            // Calculate how many more records we need
            const recordsNeeded = targetRecords - allData.length;
            const recordsToAdd = pageData.slice(0, recordsNeeded);
            
            allData.push(...recordsToAdd);
            
            console.log(`   ✓ Found ${pageData.length} records on page ${currentPage}`);
            console.log(`   ✓ Added ${recordsToAdd.length} records`);
            console.log(`   ✓ Total collected: ${allData.length}/${targetRecords}\n`);
            
            // Stop if we've reached our target
            if (allData.length >= targetRecords) {
                console.log(`🎉 Successfully collected ${allData.length} records!`);
                break;
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
    
    // Save the 100 records to JSON file
    if (allData.length > 0) {
        saveToJSONFile(allData);
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

function saveToJSONFile(data) {
    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `sebi_fpi_100_records_${timestamp}.json`;
    const filepath = path.join(__dirname, filename);
    
    // Create JSON with proper formatting
    const jsonContent = JSON.stringify({
        totalRecords: data.length,
        targetRecords: 100,
        extractedDate: new Date().toISOString(),
        data: data
    }, null, 2);
    
    // Write to file
    fs.writeFileSync(filepath, jsonContent, 'utf8');
    console.log(`\n💾 Data saved to: ${filepath}`);
    console.log(`📊 Total records saved: ${data.length}`);
    
    // Also save a simplified version
    const simpleFilename = `sebi_fpi_100_records_simple_${timestamp}.json`;
    const simpleFilepath = path.join(__dirname, simpleFilename);
    fs.writeFileSync(simpleFilepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`💾 Simplified data saved to: ${simpleFilepath}`);
    
    // Display first 3 records as sample
    if (data.length > 0) {
        console.log('\n📋 Sample of first 3 records:');
        console.log(JSON.stringify(data.slice(0, 3), null, 2));
        
        console.log('\n📑 Fields captured:');
        Object.keys(data[0]).forEach(field => {
            console.log(`   - ${field}`);
        });
    }
}

// Run the function to get 100 records
get100Records();