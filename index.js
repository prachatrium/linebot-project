require('dotenv').config();

const express = require('express');
const app = express();
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const jsQR = require('jsqr');
const { createCanvas, loadImage } = require('canvas');
const vision = require('@google-cloud/vision');
const line = require('@line/bot-sdk');
const admin = require('firebase-admin');
const base64 = process.env.GOOGLE_CREDENTIALS_BASE64;
const serviceAccount = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET
};
// LINE Webhook Endpoint
app.post('/webhook', middleware, (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// REPLACE this with actual event handler function
async function handleEvent(event) {
  console.log("Event received", event.type);
  return Promise.resolve(null);
}


// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount), // Use the same serviceAccount you have
  storageBucket: 'yakultdata2', // Replace with your actual Firebase Storage bucket name
});

// Get a reference to the storage service
const bucket = admin.storage().bucket();

// Initialize a Google Vision client
const visionclient = new vision.ImageAnnotatorClient({
  keyFilename: './yakultdata-e17363f4c9dd.json', // Replace with your service account file path
});

const client = new line.Client({
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
});

// Queue to handle tasks one at a time
let taskQueue = [];
let isProcessing = false;

// Replace with your actual Line group IDs
const TARGET_GROUP_IDS = {
  A: 'Ccbf5de38cbdcfebfc184f99f5a565a16',
  B: 'C9754e8705ccf1f0f86a90fb0a1ac2d25',
  C: 'Ce555e62003c8b71281fa2aee68fff4e0',
};

// List of supervisor/admin IDs
const supervisorIds = ['เก่ง', 'อ๋อย', 'หน่อย', 'เปิ้ล', 'กุ้ง', 'อร', 'บุ๋ม', 'โอ๊ต','รส','บาน','เบญ','รัช','ปุ๊ก', 'นุ่น', 'นุช', 'อ้อม', 'หล้า', 'โด้', 'นุ', 'AG'];


// Function to get authenticated Google Sheets client
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

// Function to get authenticated Google Drive client
async function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/photoslibrary'],
  });
  const authClient = await auth.getClient();
  return google.drive({ version: 'v3', auth: authClient });
}

// Function to process tasks sequentially
function processQueue() {
  if (taskQueue.length === 0 || isProcessing) return;

  isProcessing = true;
  const task = taskQueue.shift(); // Take the first task from the queue

  task()
    .then(() => {
      isProcessing = false;
      processQueue(); // Process the next task after the current one finishes
    })
    .catch(err => {
      console.error(err);
      isProcessing = false;
      processQueue(); // Ensure the queue continues even after an error
    });
}

async function handleEvent(event) {
  console.log('Received event:', event);

  if (event.type === 'message') {
    if (event.message.type === 'image') {
      // Process image messages from any source
      console.log('Image message received.');
      taskQueue.push(() => handleImage(event));
      processQueue();
    } else if (event.message.type === 'text') {
      // Process text messages
      console.log('Text message received.');
      taskQueue.push(() => handleTextEvent(event));
      processQueue();
    }
  }
  return Promise.resolve(null);
}
function isInventoryMessage(message) {
  const pattern = /^(.+?)([+-])กป(\d+)(\*)?$/;
  return pattern.test(message.trim());
}


// Add the handleTextMessage function
async function handleOrderMessage(event) {
  try {
    const messageText = event.message.text;

    // Parse the message to extract data
    const parsedData = parseOrderMessage(messageText);

    if (parsedData) {
      // Append data to Google Sheets
      const sheets = await getSheetsClient();
      await appendDataToSheet(sheets, parsedData);

      console.log('Data appended to Google Sheets.');
    } else {
      console.log('Failed to parse the message.');
    }
  } catch (error) {
    console.error('Error handling text message:', error);
  }
}


async function handleTextEvent(event) {
  try {
    // Define the target group IDs
    const inventoryGroupId = 'C13180b7ee8be340e679fba2158f4c63f'; // Replace with your actual inventory group ID
    const orderGroupId = 'C598389461b750bfe350aaab23cca689b'; // Your existing order group ID

    // Check if the message is from a group
    if (event.source.type === 'group') {
      const groupId = event.source.groupId;

      // Check if the message is from the inventory group
      if (groupId === inventoryGroupId) {
        const messageText = event.message.text.trim();

        // Check if the message is an inventory message
        if (isInventoryMessage(messageText)) {
          // Expand shorthand notation if present
          const expandedCommands = expandShorthandCommands(messageText);

          // Process each command individually
          for (const command of expandedCommands) {
            await processInventoryMessage(command);
          }
        } else {
          console.log('Message in inventory group does not match inventory message format.');
        }
      }
      // Check if the message is from the order group
      else if (groupId === orderGroupId) {
        const messageText = event.message.text.trim();

        if (messageText.includes('รายการใหม่:')) {
          console.log('รายการใหม่: message received in target group.');
          await handleOrderMessage(event);
        } else {
          console.log('Message in order group does not match order message format.');
        }
      } else {
        console.log('Message received from non-target group. Ignoring.');
      }
    } else {
      console.log('Message received from non-group chat. Ignoring.');
    }
  } catch (error) {
    console.error('Error handling text event:', error);
    // Optionally, log the error to your "Error" sheet
    await logErrorToSheet('Text Event Error', event.message.text, error.message);
  }
}


function expandShorthandCommands(message) {
  const commands = [];

  // Use case-insensitive regex
  const shorthandPattern = /^(xx)?(.+?)([+-])กป(\d+)(\*)?$/i;
  const match = message.match(shorthandPattern);

  if (match) {
    const isCorrection = !!match[1]; // Check if 'xx' prefix is present
    const idsPart = match[2].trim();
    const transactionType = match[3];
    const amount = match[4];
    const isBankTransfer = match[5] === '*';

    // Split the IDs by '/'
    const ids = idsPart.split('/').map(id => id.trim()).filter(id => id !== '');

    // Construct individual commands
    for (const id of ids) {
      let individualCommand = '';
      if (isCorrection) {
        individualCommand += match[1]; // Preserve the original 'xx' variation
      }
      individualCommand += `${id}${transactionType}กป${amount}`;
      if (isBankTransfer) {
        individualCommand += '*';
      }
      commands.push(individualCommand);
    }
  } else {
    // No shorthand notation, return the original message as a single command
    commands.push(message);
  }

  return commands;
}



async function processInventoryMessage(message) {
  try {
    // Parse the message
    const parsedData = parseInventoryMessage(message);

    if (parsedData) {
      const { isCorrection, salesId } = parsedData;

      // Determine if the ID is a supervisor/admin
      parsedData.isSupervisor = supervisorIds.includes(salesId);

      // Adjust the amount if it's a correction
      if (isCorrection) {
        parsedData.amount = -parsedData.amount;
      }

      // Update the sales sheet
      const sheets = await getSheetsClient();
      await updateSalesSheet(sheets, parsedData);

    
      console.log(`Inventory data updated for ${salesId}.`);
    } else {
      console.log(`Failed to parse the inventory message: ${message}`);
      // Log the error to the "Error" sheet
      await logErrorToSheet('Parsing Error', message, 'Failed to parse the inventory message.');
    }
  } catch (error) {
    console.error('Error processing inventory message:', error);
    // Log the error to the "Error" sheet
    await logErrorToSheet('Processing Error', message, error.message);
  }
}


function parseInventoryMessage(message) {
  const pattern = /^(xx)?(.+?)([+-])กป(\d+)(\*)?$/i; // Added 'i' flag for case-insensitivity
  const match = message.match(pattern);

  if (match) {
    const isCorrection = !!match[1]; // Check if 'xx' prefix is present
    const salesId = match[2].trim();
    const transactionType = match[3];
    const amount = parseInt(match[4], 10);
    const isBankTransfer = match[5] === '*';

    return {
      isCorrection,
      salesId,
      transactionType,
      amount,
      isBankTransfer,
      originalMessage: message,
    };
  } else {
    return null;
  }
}



async function updateSalesSheet(sheets, data) {
  const spreadsheetId = '19sSXRA5pDtG5B0AMc9BUW_iL6k1RpKrx-fPefYjcCPM'; // Replace with your actual spreadsheet ID
  const { salesId, transactionType, amount, isBankTransfer, originalMessage } = data;

  // Prepare data for the row
  const dateTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  const withdrawal = transactionType === '+' ? amount : '';
  const payment = transactionType === '-' && !isBankTransfer ? amount : '';
  const transfer = transactionType === '-' && isBankTransfer ? amount : '';
  let balance = 0; // We'll calculate this based on the previous balance

  // Fetch the individual sales sheet
  const salesSheetName = salesId;
  const salesRange = `'${salesSheetName}'!A:F`;
  // List of supervisor/admin IDs
const supervisorIds = ['เก่ง', 'อ๋อย', 'หน่อย', 'เปิ้ล', 'กุ้ง', 'อร', 'บุ๋ม', 'AG'];


  // Check if the sheet exists
  let sheetExists = false;
  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    sheetExists = spreadsheet.data.sheets.some(
      (sheet) => sheet.properties.title === salesSheetName
    );
  } catch (error) {
    console.error('Error fetching spreadsheet data:', error);
    // Log the error with the original message
    await logErrorToSheet('Spreadsheet Access Error', originalMessage, error.message);
    return; // Exit the function since we cannot proceed
  }

  if (!sheetExists) {
    const errorMsg = `Sheet "${salesSheetName}" does not exist.`;
    console.error(errorMsg);
    // Log the error with the original message
    await logErrorToSheet('Sheet Not Found', originalMessage, errorMsg);
    return; // Exit the function since we cannot proceed
  }

  // Get the previous balance
  let prevBalance = 0;
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${salesSheetName}'!F:F`, // Balance column
    });
    const rows = response.data.values;
    if (rows && rows.length > 1) {
      const lastRow = rows.length;
      const lastBalance = parseFloat(rows[lastRow - 1][0]);
      if (!isNaN(lastBalance)) {
        prevBalance = lastBalance;
      }
    }
  } catch (error) {
    console.error('Error fetching previous balance:', error);
    // Log the error with the original message
    await logErrorToSheet('Balance Fetch Error', originalMessage, error.message);
    return; // Exit the function since we cannot proceed
  }

  // Calculate the new balance
  balance =
    prevBalance +
    (withdrawal ? amount : 0) -
    (payment ? amount : 0) -
    (transfer ? amount : 0);

  // Prepare the row data
  const values = [
    [
      dateTime, // วันที่
      salesId, // เขต
      withdrawal, // เบิก(ใบ)
      payment, // จ่าย(ใบ)
      transfer, // โอน(ใบ)
      balance, // คงเหลือ(ใบ)
    ],
  ];

  const resource = {
    values,
  };

  // Append the data to the individual sales sheet
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: salesRange,
      valueInputOption: 'USER_ENTERED',
      resource,
    });
    console.log(`Data appended to sales sheet ${salesSheetName}.`);
  } catch (error) {
    console.error(`Error appending data to sales sheet ${salesSheetName}:`, error);
    // Log the error with the original message
    await logErrorToSheet('Append Error', originalMessage, error.message);
    return;
  }

  // Append the data to the "Main" sheet
  const mainSheetName = 'Main';
  const mainRange = `'${mainSheetName}'!A:F`;

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: mainRange,
      valueInputOption: 'USER_ENTERED',
      resource,
    });
    console.log('Data appended to Main sheet.');
  } catch (error) {
    console.error('Error appending data to Main sheet:', error);
    // Log the error with the original message
    await logErrorToSheet('Append Error', originalMessage, error.message);
  }
}

async function logErrorToSheet(errorType, message, errorInfo) {
  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = '19sSXRA5pDtG5B0AMc9BUW_iL6k1RpKrx-fPefYjcCPM'; // Replace with your actual spreadsheet ID
    const errorSheetName = 'Error';
    const errorRange = `'${errorSheetName}'!A:C`;

    const dateTime = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

    const values = [
      [
        dateTime,         // Date and Time
        message || '',    // Original Message
        `${errorType}: ${errorInfo}`, // Error Information
      ],
    ];

    const resource = {
      values,
    };

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: errorRange,
      valueInputOption: 'USER_ENTERED',
      resource,
    });

    console.log('Error logged to Error sheet.');
  } catch (error) {
    console.error('Error logging to Error sheet:', error);
  }
}



// Add the parseOrderMessage function
function parseOrderMessage(messageText) {
  // Split the message into lines
  const lines = messageText.split('\n');

  // Initialize variables for each field
  let name = '';
  let phone = '';
  let addressLines = [];
  let orderQuantity = '';
  let deliveryDate = '';

  // Iterate over the lines to extract data
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('ชื่อ :')) {
      name = line.substring('ชื่อ :'.length).trim();
    } else if (line.startsWith('โทรศัพท์ :')) {
      phone = line.substring('โทรศัพท์ :'.length).trim();
    } else if (line.startsWith('ที่อยู่ :')) {
      addressLines.push(line.substring('ที่อยู่ :'.length).trim());
    } else if (line.startsWith('แขวง / ต. :')) {
      addressLines.push(line.substring('แขวง / ต. :'.length).trim());
    } else if (line.startsWith('เขต / อ. :')) {
      addressLines.push(line.substring('เขต / อ. :'.length).trim());
    } else if (line.startsWith('สั่งกระเป๋า :')) {
      orderQuantity = line.substring('สั่งกระเป๋า :'.length).trim();
    } else if (line.startsWith('วันนัดส่ง :')) {
      deliveryDate = line.substring('วันนัดส่ง :'.length).trim();
    }
  }

  // Return an object containing the extracted data
  return {
    name,
    phone,
    address: addressLines.join('\n'),
    orderQuantity,
    deliveryDate,
  };
}

// Add the appendDataToSheet function
async function appendDataToSheet(sheets, data) {
  const spreadsheetId = '1sxPAnbUQSiGft871VsOIRPLdsUR6SQI54G07z3GEsTA'; // Replace with your Google Sheet ID
  const sheetName = 'Sheet1'; // Replace with your actual sheet name
  const range = `'${sheetName}'!A:I`; // Use the exact sheet name

  // Get the current date in your desired format (Thai locale)
  const dateReceived = new Date().toLocaleDateString('th-TH');

  // Step 1: Get the existing data to determine the next order number
  let orderNumber = 1; // Default to 1 if no data exists

  try {
    const getResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:I`, // Get the "ลำดับ" column
    });

    const rows = getResponse.data.values;
    if (rows && rows.length > 1) {
      // Assuming the first row is the header
      const lastRow = rows[rows.length - 1];
      const lastOrderNumber = parseInt(lastRow[0]);
      if (!isNaN(lastOrderNumber)) {
        orderNumber = lastOrderNumber + 1;
      }
    }
  } catch (error) {
    console.error('Error retrieving data from Google Sheets:', error);
  }

  // Prepare the row data
const values = [
  [
    orderNumber.toString(),       // ลำดับ
    dateReceived,                 // วันที่รับออเดอร์
    data.name || '',              // ชื่อ
    "'" + (data.phone || ''),     // เบอร์ (prefix with a single quote)
    data.address || '',           // ที่อยู่
    '',                           // เขต (left empty for user to fill)
    data.orderQuantity || '',     // จำนวนสั่งรับ
    data.deliveryDate || '',      // วันนัด
    '',                           // หมายเหตุ (left empty for user to fill)
  ],
];

  const resource = {
    values,
  };

  console.log('Data to append:', values);

  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      resource,
    });
    console.log('Data appended successfully.');
    console.log('Append response:', response.data);
  } catch (error) {
    console.error('Error appending data to Google Sheets:', error);
    throw error;
  }
}

// Function to match patterns for different target groups (unchanged)
function matchLoose(text) {
  const matchA = /xxx|deposit/i; // Group A match

  // Fuzzy match for Group B: allowing 0/O confusion and optional spaces/hyphens
  const matchB = /0[O]{0,1}30[-\s]?553[-\s]?/i;

  // Fuzzy match for Group C: allowing 0/O confusion and optional spaces/hyphens
  const matchC = /0[O]{0,1}44[-\s]?246|0[O]{0,1}44[-\s]?313/i;

  if (matchA.test(text)) return 'A';
  if (matchB.test(text)) return 'B';
  if (matchC.test(text)) return 'C';
  return null;
}

// QR code detection function (unchanged)
async function detectQRCode(imagePath) {
  const img = await loadImage(imagePath);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  const code = jsQR(imageData.data, img.width, img.height);

  if (code) {
    return code.data; // QR code data
  }
  return null; // No QR code found
}

let requestCount = 0;
const MAX_REQUESTS_PER_MONTH = 1000; // Free tier limit

const { Storage } = require('@google-cloud/storage');

// Initialize the Google Cloud Storage client
const storage = new Storage({
  credentials: serviceAccount, // Use your existing serviceAccount variable
});

async function uploadImageToFirebase(imageBuffer, destination) {
  try {
    const file = bucket.file(destination);
    await file.save(imageBuffer, {
      metadata: {
        contentType: 'image/jpeg',
      },
    });

    console.log(`Image uploaded to Firebase Storage as ${destination}.`);

    // Generate a signed URL for the uploaded file
    const options = {
      version: 'v4',
      action: 'read',
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // Expires in 7 days
    };

    const [url] = await file.getSignedUrl(options);
    console.log('Signed URL:', url);

    return url;
  } catch (error) {
    console.error('Error uploading image to Firebase:', error);
    throw error;
  }
}


async function handleImage(event) {
  console.log('Handling image message:', event.message.id);

  try {
    const messageId = event.message.id;
    const stream = await client.getMessageContent(messageId);

    // Collect data chunks into a buffer instead of saving to disk
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    console.log('Image received and stored in memory.');

    // Initialize matchResult
    let matchResult;

    // Step 1: Attempt QR code detection
    const qrCodeData = await detectQRCode(imageBuffer);

    if (qrCodeData) {
      console.log('QR Code detected:', qrCodeData);
      matchResult = 'A'; // Adjust this based on your QR code data handling
    } else {
      console.log(`Vision API called. Current count: ${requestCount}`);

      if (requestCount >= MAX_REQUESTS_PER_MONTH) {
        console.log('Vision API request limit reached. Skipping OCR.');
        matchResult = 'A'; // Default action when limit is reached
      } else {
        // Step 2: Perform OCR using Google Vision API
        const [result] = await visionclient.textDetection(imageBuffer);
        const extractedText = result.textAnnotations[0]?.description || '';
        console.log('Extracted Text:', extractedText);

        // Increment the request counter
        requestCount++;

        // Check if the OCR matches any condition
        matchResult = matchLoose(extractedText);
      }
    }

    if (matchResult === 'A' || matchResult === 'B' || matchResult === 'C') {
      const targetGroupId = TARGET_GROUP_IDS[matchResult];

      if (targetGroupId) {
        // Upload image to Firebase Storage and get a signed URL
        const firebaseImageUrl = await uploadImageToFirebase(imageBuffer, `${messageId}.jpg`);

        // Use the signed URL for both originalContentUrl and previewImageUrl
        const message = {
          type: 'image',
          originalContentUrl: firebaseImageUrl,
          previewImageUrl: firebaseImageUrl,
        };

        await client.pushMessage(targetGroupId, message);

        console.log(`Image sent to Line group "${targetGroupId}".`);

        // Optionally, delete the image from Firebase Storage after some time
        // setTimeout(async () => {
        //   await bucket.file(`${messageId}.jpg`).delete();
        //   console.log('Image deleted from Firebase Storage.');
        // }, 10000); // Delete after 10 seconds
      } else {
        console.log('No target group ID found for matchResult:', matchResult);
      }
    } else {
      console.log('No matching text found. No action taken.');
    }

    // If you choose to delete the image immediately (may cause issues if LINE hasn't fetched it yet)
    // await bucket.file(`${messageId}.jpg`).delete();
    // console.log('Image deleted from Firebase Storage.');

    // No need to clean up local files since we're processing in memory
  } catch (error) {
    if (error.response && error.response.data) {
      console.error('Error response from LINE API:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error in handleImage:', error);
    }
  }
}

app.post(
  '/webhook',
  line.middleware({ channelSecret: process.env.CHANNEL_SECRET }),
  (req, res) => {
    Promise.all(req.body.events.map(handleEvent))
      .then((result) => res.json(result))
      .catch((err) => {
        console.error(err);
        res.status(500).end();
      });
  }
);

app.listen(process.env.PORT || 3001, () => {
  console.log(`Server is running on port ${process.env.PORT || 3001}`);
});
