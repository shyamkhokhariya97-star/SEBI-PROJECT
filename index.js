const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');

async function callSebiAPI() {
    const url = 'https://www.sebi.gov.in/sebiweb/ajax/other/getintmfpiinfo.jsp';
    
    const formData = new URLSearchParams();
    formData.append('nextValue', '3');
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
    formData.append('doDirect', '3');
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
        console.log('Response Status:', response.status);
        
        // Parse HTML and extract JSON data
        const finalData = extractDataFromHTML(htmlData);
        console.log('Extracted Data:', JSON.stringify(finalData, null, 2));
        
        return finalData;
    } catch (error) {
        console.error('Error:', error);
    }
}

function extractDataFromHTML(htmlString) {
    // Create a DOM parser
    const dom = new JSDOM(htmlString);
    const document = dom.window.document;
    
    const finalData = [];
    
    // Select all tables with the specified class
    document.querySelectorAll('.fixed-table-body.card-table').forEach(table => {
        const obj = {};
        
        // Find all card-view items within card-table-left
        table.querySelectorAll('.card-table-left .card-view').forEach(item => {
            const titleElement = item.querySelector('.title span');
            const valueElement = item.querySelector('.value span');
            
            const title = titleElement ? titleElement.textContent.trim() : null;
            const value = valueElement ? valueElement.textContent.trim() : null;
            
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

// Call the function
callSebiAPI();